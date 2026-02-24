import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, symlinkSync, lstatSync, readdirSync, watch, type FSWatcher, mkdirSync } from 'node:fs';
import { v4 as uuid } from 'uuid';
import pino from 'pino';
import type { Session, CreateSessionRequest, SessionBackend } from '@claude-air/shared';
import { TMUX_SESSION_PREFIX } from '@claude-air/shared';
import { getDb } from '../db/index.js';
import { TmuxControlMode } from './tmux-control.service.js';
import { MockTmuxControlMode } from './mock-tmux.service.js';
import { PtyDirectMode } from './pty-direct.service.js';
import { MultiplexerRegistry } from './multiplexer.service.js';

const log = pino({ name: 'session' });

type ControlMode = TmuxControlMode | MockTmuxControlMode | PtyDirectMode;

interface SessionRow {
  id: string;
  name: string;
  tmux_session: string;
  workspace_path: string;
  status: string;
  type: string | null;
  skip_permissions: number;
  claude_session_id: string | null;
  backend: string | null;
  created_at: string;
  last_activity: string;
}

function rowToSession(row: SessionRow): Session {
  return {
    id: row.id,
    name: row.name,
    tmuxSession: row.tmux_session,
    workspacePath: row.workspace_path,
    status: row.status as Session['status'],
    type: (row.type as Session['type']) || 'claude',
    skipPermissions: row.skip_permissions === 1,
    claudeSessionId: row.claude_session_id ?? undefined,
    backend: (row.backend as SessionBackend) || 'tmux',
    createdAt: row.created_at,
    lastActivity: row.last_activity,
  };
}

const IS_WINDOWS = process.platform === 'win32';

/**
 * Convert a Windows path to a WSL path.
 * C:\Users\foo\bar → /mnt/c/Users/foo/bar
 */
function toWslPath(winPath: string): string {
  const match = winPath.match(/^([A-Za-z]):([\\/].*)?$/);
  if (!match) return winPath;
  const drive = match[1].toLowerCase();
  const rest = (match[2] || '').replace(/\\/g, '/');
  return `/mnt/${drive}${rest}`;
}

/**
 * Convert a WSL path back to a Windows path.
 * /mnt/c/Users/foo/bar → C:\Users\foo\bar
 */
function fromWslPath(wslPath: string): string {
  const match = wslPath.match(/^\/mnt\/([a-z])(\/.*)?$/);
  if (!match) return wslPath;
  const drive = match[1].toUpperCase();
  const rest = (match[2] || '').replace(/\//g, '\\');
  return `${drive}:${rest}`;
}

/**
 * Encode a Windows path to Claude Code's project folder name.
 * F:\Raphael\Backups → F--Raphael-Backups
 */
function encodeWindowsFolderName(winPath: string): string {
  const match = winPath.match(/^([A-Za-z]):\\(.*)$/);
  if (!match) return winPath;
  return `${match[1]}--${match[2].replace(/\\/g, '-')}`;
}

/**
 * Encode a WSL path to Claude Code's project folder name.
 * /mnt/f/Raphael/Backups → -mnt-f-Raphael-Backups
 * Claude Code on Linux replaces all / with - in the cwd.
 */
function encodeWslFolderName(wslPath: string): string {
  return wslPath.replace(/\//g, '-');
}

/**
 * Ensure the WSL-encoded project folder exists as a symlink to the Windows-encoded one.
 * Claude Code in WSL encodes /mnt/f/... differently than Windows encodes F:\...
 * Without this, --resume can't find sessions created by Windows-native Claude Code.
 */
function ensureProjectSymlink(workspacePath: string): void {
  const winFolder = encodeWindowsFolderName(workspacePath);
  const wslFolder = encodeWslFolderName(toWslPath(workspacePath));
  if (winFolder === wslFolder) return;

  const projectsDir = join(homedir(), '.claude', 'projects');
  const winTarget = join(projectsDir, winFolder);
  const wslLink = join(projectsDir, wslFolder);

  // Only create if the Windows folder exists and the WSL link doesn't
  if (!existsSync(winTarget)) return;
  try {
    if (lstatSync(wslLink).isSymbolicLink()) return; // already linked
    return; // exists as a real directory — don't touch
  } catch {
    // Doesn't exist — create the symlink
  }

  try {
    symlinkSync(winTarget, wslLink, 'junction');
    log.info({ winFolder, wslFolder }, 'created project symlink for WSL path');
  } catch (err) {
    log.warn({ err, winFolder, wslFolder }, 'failed to create project symlink');
  }
}

function tryTmux(...args: string[]): string {
  if (IS_WINDOWS) {
    // Use bash -c to preserve tmux format strings like #{session_name}.
    // wsl.exe's default shell layer strips # characters, breaking -F arguments.
    const escaped = args.map(a => a.replace(/'/g, "'\\''"));
    const cmd = `tmux ${escaped.map(a => `'${a}'`).join(' ')}`;
    return execFileSync('wsl', ['bash', '-c', cmd], { stdio: 'pipe' }).toString();
  }
  return execFileSync('tmux', args, { stdio: 'pipe' }).toString();
}

export class SessionService {
  private controllers: Map<string, ControlMode> = new Map();
  private sessionWatchers: Map<string, FSWatcher> = new Map();
  private multiplexers: MultiplexerRegistry;
  private mockMode: boolean;

  constructor(multiplexers: MultiplexerRegistry) {
    this.multiplexers = multiplexers;
    this.mockMode = !this.checkTmux();
    if (this.mockMode) {
      log.warn('tmux not found - running in MOCK mode. Sessions will simulate terminal output.');
    }
  }

  /**
   * Check if tmux is available.
   */
  checkTmux(): boolean {
    try {
      tryTmux('-V');
      return true;
    } catch {
      return false;
    }
  }

  get isMockMode(): boolean {
    return this.mockMode;
  }

  /**
   * Create a new Claude Code session.
   * In mock mode: no real tmux, just a simulated terminal.
   * In real mode: creates a tmux session running Claude Code CLI.
   */
  async create(req: CreateSessionRequest): Promise<Session> {
    const db = getDb();
    const id = uuid();
    const backend: SessionBackend = req.backend || 'tmux';
    const tmuxName = backend === 'pty'
      ? `pty-${id.substring(0, 8)}`
      : `${TMUX_SESSION_PREFIX}${id.substring(0, 8)}`;

    if (backend === 'pty') {
      // Direct PTY — native PowerShell (or bash on Linux), no tmux
      const sessionType = req.type || 'claude';
      const initialClaudeId = req.claudeResumeId || null;
      db.prepare(`
        INSERT INTO sessions (id, name, tmux_session, workspace_path, status, type, skip_permissions, claude_session_id, backend)
        VALUES (?, ?, ?, ?, 'running', ?, ?, ?, 'pty')
      `).run(id, req.name, tmuxName, req.workspacePath, sessionType, req.skipPermissions ? 1 : 0, initialClaudeId);

      this.attachPtyDirect(id, req.workspacePath, req);

      // For new Claude sessions (not resuming), watch for the session file
      if (sessionType === 'claude' && !initialClaudeId) {
        this.watchForClaudeSession(id, req.workspacePath);
      }

      const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow;
      log.info({ id, tmuxName, workspace: req.workspacePath, backend: 'pty' }, 'PTY session created');
      return rowToSession(row);
    }

    // ── tmux backend (existing logic) ──
    if (!this.mockMode) {
      const startDir = IS_WINDOWS ? toWslPath(req.workspacePath) : req.workspacePath;
      try {
        tryTmux('new-session', '-d', '-s', tmuxName, '-c', startDir, '-x', '80', '-y', '24');
        try { tryTmux('set-option', '-t', tmuxName, 'status', 'off'); } catch { /* ignore */ }
      } catch (err) {
        log.error({ err, tmuxName }, 'failed to create tmux session');
        throw new Error(`Failed to create tmux session: ${err}`);
      }

      if (req.type !== 'shell') {
        let claudeCmd = 'claude';
        if (req.claudeResumeId) {
          claudeCmd += ` --resume ${req.claudeResumeId}`;
        }
        if (req.skipPermissions) claudeCmd += ' --dangerously-skip-permissions';
        if (req.claudeArgs) claudeCmd += ` ${req.claudeArgs}`;

        if (IS_WINDOWS) {
          const wslHome = toWslPath(homedir());
          claudeCmd = `HOME="${wslHome}" ${claudeCmd}`;
          ensureProjectSymlink(req.workspacePath);
        }

        try {
          tryTmux('send-keys', '-t', tmuxName, claudeCmd, 'Enter');
        } catch (err) {
          try { tryTmux('kill-session', '-t', tmuxName); } catch { /* ignore */ }
          throw new Error(`Failed to start Claude Code: ${err}`);
        }
      } else {
        const startDir2 = IS_WINDOWS ? toWslPath(req.workspacePath) : req.workspacePath;
        try {
          tryTmux('send-keys', '-t', tmuxName, `cd "${startDir2}"`, 'Enter');
        } catch { /* non-fatal */ }
      }
    }

    const sessionType = req.type || 'claude';
    db.prepare(`
      INSERT INTO sessions (id, name, tmux_session, workspace_path, status, type, skip_permissions, claude_session_id, backend)
      VALUES (?, ?, ?, ?, 'running', ?, ?, ?, 'tmux')
    `).run(id, req.name, tmuxName, req.workspacePath, sessionType, req.skipPermissions ? 1 : 0, tmuxName);

    this.attachControlMode(id, tmuxName);

    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow;
    log.info({ id, tmuxName, workspace: req.workspacePath, mock: this.mockMode }, 'session created');
    return rowToSession(row);
  }

  /**
   * Spawn a direct PTY (native PowerShell) and optionally launch Claude Code inside it.
   */
  private attachPtyDirect(sessionId: string, cwd: string, req?: CreateSessionRequest): void {
    const ctrl = new PtyDirectMode();
    this.controllers.set(sessionId, ctrl);

    const mux = this.multiplexers.getOrCreate(sessionId);

    ctrl.on('output', (_paneId: string, data: string) => {
      mux.broadcast(data);
      this.updateActivity(sessionId);
    });

    ctrl.on('detached', () => {
      log.info({ sessionId }, 'direct PTY detached');
      this.controllers.delete(sessionId);
      this.updateStatus(sessionId, 'stopped');
    });

    ctrl.on('error', (err: Error) => {
      log.error({ err, sessionId }, 'direct PTY error');
    });

    ctrl.attach(cwd);

    // For Claude sessions, type the claude command into the shell
    if (req && req.type !== 'shell') {
      let claudeCmd = 'claude';
      if (req.claudeResumeId) {
        claudeCmd += ` --resume ${req.claudeResumeId}`;
      }
      if (req.skipPermissions) claudeCmd += ' --dangerously-skip-permissions';
      if (req.claudeArgs) claudeCmd += ` ${req.claudeArgs}`;

      // Small delay to let the shell prompt initialize
      setTimeout(() => {
        ctrl.sendKeys('', claudeCmd + '\r');
      }, 500);
    }
  }

  /**
   * Watch ~/.claude/projects/<folder>/ for a new .jsonl file using fs.watch.
   * Snapshot existing files first, then wait for a new one to appear.
   * Event-driven — no race condition, no polling.
   */
  private watchForClaudeSession(sessionId: string, workspacePath: string): void {
    try {
      const projectFolder = encodeWindowsFolderName(workspacePath);
      const projectDir = join(homedir(), '.claude', 'projects', projectFolder);

      // Ensure the directory exists (Claude may not have created it yet)
      if (!existsSync(projectDir)) {
        mkdirSync(projectDir, { recursive: true });
      }

      // Snapshot existing .jsonl files so we can detect the new one
      const existing = new Set(
        readdirSync(projectDir).filter(f => f.endsWith('.jsonl'))
      );

      const watcher = watch(projectDir, (eventType, filename) => {
        if (!filename || !filename.endsWith('.jsonl')) return;
        if (existing.has(filename)) return;

        // New .jsonl file — this is the Claude session ID
        const claudeSessionId = filename.replace('.jsonl', '');
        const db = getDb();
        db.prepare('UPDATE sessions SET claude_session_id = ? WHERE id = ?')
          .run(claudeSessionId, sessionId);
        log.info({ sessionId, claudeSessionId }, 'detected Claude session ID via fs.watch');

        // Clean up watcher
        watcher.close();
        this.sessionWatchers.delete(sessionId);
      });

      watcher.on('error', (err) => {
        log.warn({ err, sessionId }, 'fs.watch error on projects dir');
        watcher.close();
        this.sessionWatchers.delete(sessionId);
      });

      this.sessionWatchers.set(sessionId, watcher);

      // Safety timeout — stop watching after 60s if nothing detected
      setTimeout(() => {
        if (this.sessionWatchers.has(sessionId)) {
          watcher.close();
          this.sessionWatchers.delete(sessionId);
          log.warn({ sessionId }, 'Claude session ID detection timed out');
        }
      }, 60000);
    } catch (err) {
      log.warn({ err, sessionId }, 'failed to set up fs.watch for Claude session detection');
    }
  }

  private attachControlMode(sessionId: string, tmuxName: string): void {
    const ctrl: ControlMode = this.mockMode
      ? new MockTmuxControlMode()
      : new TmuxControlMode();

    this.controllers.set(sessionId, ctrl);

    const mux = this.multiplexers.getOrCreate(sessionId);

    ctrl.on('output', (_paneId: string, data: string) => {
      mux.broadcast(data);
      this.updateActivity(sessionId);
    });

    ctrl.on('detached', () => {
      log.info({ sessionId }, 'control mode detached');
      this.controllers.delete(sessionId);
    });

    ctrl.on('error', (err: Error) => {
      log.error({ err, sessionId }, 'control mode error');
    });

    try {
      ctrl.attach(tmuxName);
    } catch (err) {
      log.error({ err, sessionId }, 'failed to attach control mode');
      this.controllers.delete(sessionId);
    }
  }

  list(): Session[] {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM sessions ORDER BY created_at DESC').all() as SessionRow[];

    return rows.map((row) => {
      const session = rowToSession(row);
      if (session.status === 'running' || session.status === 'idle') {
        if (session.backend === 'pty') {
          // PTY sessions: alive only if controller exists
          if (!this.controllers.has(session.id)) {
            this.updateStatus(session.id, 'stopped');
            session.status = 'stopped';
          }
        } else if (!this.mockMode) {
          if (!this.isTmuxSessionAlive(session.tmuxSession)) {
            this.updateStatus(session.id, 'stopped');
            session.status = 'stopped';
          }
        }
      }
      return session;
    });
  }

  get(id: string): Session | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
    if (!row) return null;
    return rowToSession(row);
  }

  async kill(id: string): Promise<void> {
    const session = this.get(id);
    if (!session) throw new Error('Session not found');

    if (session.backend === 'pty') {
      // Direct PTY — just kill the controller
      const ctrl = this.controllers.get(id);
      if (ctrl) {
        ctrl.detach();
        this.controllers.delete(id);
      }
    } else {
      // tmux — Kill tmux FIRST so the PTY exits naturally (avoids ConPTY AttachConsole error on Windows)
      if (!this.mockMode) {
        try {
          tryTmux('kill-session', '-t', session.tmuxSession);
        } catch { /* Session may already be dead */ }
      }

      const ctrl = this.controllers.get(id);
      if (ctrl) {
        await new Promise((r) => setTimeout(r, 200));
        ctrl.detach();
        this.controllers.delete(id);
      }
    }

    // Clean up fs.watch if active
    const watcher = this.sessionWatchers.get(id);
    if (watcher) {
      watcher.close();
      this.sessionWatchers.delete(id);
    }

    this.multiplexers.remove(id);
    const db = getDb();
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    log.info({ id }, 'session killed and removed from DB');
  }

  async sendKeys(id: string, keys: string): Promise<void> {
    const session = this.get(id);
    if (!session) throw new Error('Session not found');

    const ctrl = this.controllers.get(id);
    if (ctrl?.attached) {
      await ctrl.sendKeys(session.tmuxSession, keys);
    } else if (session.backend !== 'pty' && !this.mockMode) {
      tryTmux('send-keys', '-t', session.tmuxSession, keys);
    }
    this.updateActivity(id);
  }

  async captureOutput(id: string, lines = 100): Promise<string> {
    const session = this.get(id);
    if (!session) throw new Error('Session not found');

    const ctrl = this.controllers.get(id);
    if (ctrl?.attached) {
      return ctrl.capturePaneContent(session.tmuxSession, lines);
    }

    if (!this.mockMode) {
      try {
        return tryTmux('capture-pane', '-t', session.tmuxSession, '-p', '-S', `-${lines}`);
      } catch {
        return '';
      }
    }

    return `[Mock session: ${session.name}]\n`;
  }

  /**
   * Re-attach control mode to a session whose streaming may have died.
   */
  reattach(id: string): Session | null {
    const session = this.get(id);
    if (!session) return null;

    if (session.backend === 'pty') {
      // PTY reconnect: spawn a new PTY
      const oldCtrl = this.controllers.get(id);
      if (oldCtrl) {
        try { oldCtrl.detach(); } catch { /* ignore */ }
        this.controllers.delete(id);
      }

      this.updateStatus(id, 'running');
      const req: CreateSessionRequest = {
        name: session.name,
        workspacePath: session.workspacePath,
        type: session.type,
        skipPermissions: session.skipPermissions,
        claudeResumeId: session.claudeSessionId,
      };
      this.attachPtyDirect(id, session.workspacePath, req);
      log.info({ id, claudeResumeId: session.claudeSessionId }, 'reattached PTY session');
      return this.get(id);
    }

    if (this.mockMode) return session;

    // Check tmux session is alive
    if (!this.isTmuxSessionAlive(session.tmuxSession)) {
      this.updateStatus(id, 'stopped');
      return this.get(id);
    }

    // Detach old controller if any
    const oldCtrl = this.controllers.get(id);
    if (oldCtrl) {
      try { oldCtrl.detach(); } catch { /* ignore */ }
      this.controllers.delete(id);
    }

    // Re-attach
    this.attachControlMode(id, session.tmuxSession);
    log.info({ id, tmux: session.tmuxSession }, 'reattached control mode');
    return this.get(id);
  }

  rename(id: string, name: string): Session | null {
    const db = getDb();
    db.prepare('UPDATE sessions SET name = ? WHERE id = ?').run(name, id);
    return this.get(id);
  }

  /**
   * On startup, just log how many sessions are available.
   * PTY attachment is lazy — triggered by the first WebSocket client.
   * This avoids spawning 30+ PTY processes simultaneously.
   */
  reattachAll(): void {
    const sessions = this.list().filter((s) => s.status === 'running' || s.status === 'idle');
    log.info({ count: sessions.length, mock: this.mockMode }, 'sessions available for lazy reattach');
  }

  /**
   * Lazily attach PTY control mode to a session.
   * Called when the first WebSocket client connects to a terminal.
   * No-op if already attached or session is not running.
   */
  ensureAttached(sessionId: string): void {
    if (this.controllers.has(sessionId)) return;

    const session = this.get(sessionId);
    if (!session) return;

    if (session.backend === 'pty') {
      // PTY reconnect: spawn a new PTY for stopped sessions
      if (session.status === 'stopped') {
        this.updateStatus(sessionId, 'running');
        const req: CreateSessionRequest = {
          name: session.name,
          workspacePath: session.workspacePath,
          type: session.type,
          skipPermissions: session.skipPermissions,
          claudeResumeId: session.claudeSessionId,
        };
        this.attachPtyDirect(sessionId, session.workspacePath, req);
        log.info({ id: sessionId, claudeResumeId: session.claudeSessionId }, 'reconnected PTY session');
      }
      return;
    }

    // tmux backend
    if (this.mockMode) return;
    if (session.status !== 'running' && session.status !== 'idle') return;

    if (!this.isTmuxSessionAlive(session.tmuxSession)) {
      this.updateStatus(sessionId, 'stopped');
      return;
    }

    this.attachControlMode(sessionId, session.tmuxSession);
    log.info({ id: sessionId, tmux: session.tmuxSession }, 'lazy-attached control mode');
  }

  /**
   * Reconcile tmux sessions with the DB on startup:
   * - Re-adopt orphan tmux sessions (alive but not in DB) by creating DB records
   * - Remove DB sessions whose tmux is dead
   */
  cleanupOrphans(): void {
    // Mark all PTY sessions as stopped — they can't survive SMS restart
    const db0 = getDb();
    const ptyMarked = db0.prepare(
      `UPDATE sessions SET status = 'stopped' WHERE backend = 'pty' AND status IN ('running', 'idle')`
    ).run();
    if (ptyMarked.changes > 0) {
      log.info({ count: ptyMarked.changes }, 'marked PTY sessions as stopped (SMS restart)');
    }

    if (this.mockMode) return;

    // 1. Get all alive cca-* tmux sessions
    let aliveSessions: string[];
    try {
      const output = tryTmux('list-sessions', '-F', '#{session_name}');
      aliveSessions = output.trim().split('\n')
        .map(s => s.trim())
        .filter(s => s.startsWith(TMUX_SESSION_PREFIX));
    } catch {
      aliveSessions = [];
    }

    // 2. Get all tracked tmux session names from DB (tmux backend only)
    const db = getDb();
    const dbRows = db.prepare("SELECT id, tmux_session, status FROM sessions WHERE backend = 'tmux' OR backend IS NULL").all() as {
      id: string; tmux_session: string; status: string;
    }[];
    const trackedNames = new Set(dbRows.map(r => r.tmux_session));

    // 3. Re-adopt orphan tmux sessions (alive but not in DB)
    let adopted = 0;
    for (const tmuxName of aliveSessions) {
      if (!trackedNames.has(tmuxName)) {
        // Query the pane's working directory to determine workspace
        let workspacePath = '';
        try {
          workspacePath = tryTmux(
            'display-message', '-t', tmuxName, '-p', '#{pane_current_path}',
          ).trim();
          // WSL returns /mnt/c/... paths — convert back to Windows C:\...
          if (IS_WINDOWS) workspacePath = fromWslPath(workspacePath);
        } catch { /* fallback to empty */ }

        // Ensure tmux status bar is off for recovered sessions
        try { tryTmux('set-option', '-t', tmuxName, 'status', 'off'); } catch { /* ignore */ }

        // Derive a session id from the tmux name (cca-<8chars> → use as uuid prefix)
        const shortId = tmuxName.replace(TMUX_SESSION_PREFIX, '');
        const id = `${shortId}-0000-0000-0000-000000000000`;
        const dirName = workspacePath.split(/[/\\]/).pop() || tmuxName;

        db.prepare(`
          INSERT OR IGNORE INTO sessions (id, name, tmux_session, workspace_path, status, type, skip_permissions)
          VALUES (?, ?, ?, ?, 'running', 'shell', 0)
        `).run(id, dirName, tmuxName, workspacePath);

        adopted++;
        log.info({ tmuxName, id, workspacePath }, 'adopted orphan tmux session');
      }
    }

    // 4. Remove DB sessions whose tmux is dead
    const aliveSet = new Set(aliveSessions);
    let removed = 0;
    for (const row of dbRows) {
      if (!aliveSet.has(row.tmux_session)) {
        db.prepare('DELETE FROM sessions WHERE id = ?').run(row.id);
        removed++;
        log.info({ id: row.id, tmux: row.tmux_session }, 'removed dead session from DB');
      }
    }

    // 5. Strip "(recovered)" suffix from session names (legacy cleanup)
    db.prepare(`UPDATE sessions SET name = REPLACE(name, ' (recovered)', '') WHERE name LIKE '% (recovered)'`).run();

    if (adopted > 0 || removed > 0) {
      log.info({ adopted, removed }, 'session reconciliation complete');
    }
  }

  getController(id: string): ControlMode | undefined {
    return this.controllers.get(id);
  }

  private isTmuxSessionAlive(tmuxName: string): boolean {
    try {
      tryTmux('has-session', '-t', tmuxName);
      return true;
    } catch {
      return false;
    }
  }

  private updateStatus(id: string, status: string): void {
    const db = getDb();
    db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run(status, id);
  }

  private updateActivity(id: string): void {
    const db = getDb();
    db.prepare("UPDATE sessions SET last_activity = datetime('now') WHERE id = ?").run(id);
  }
}
