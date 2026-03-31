import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as fs from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import { v4 as uuid } from 'uuid';
import pino from 'pino';
import type { Session, CreateSessionRequest, SessionBackend, CliProviderId } from '@air-code/shared';
import { TMUX_SESSION_PREFIX, getCliProvider, getAllCliProviders, DEFAULT_CLI_PROVIDER } from '@air-code/shared';
import { getDb } from '../db/index.js';
import type { IControlMode } from './control-mode.interface.js';
import { TmuxControlMode } from './tmux-control.service.js';
import { MockTmuxControlMode } from './mock-tmux.service.js';
import { PtyDirectMode } from './pty-direct.service.js';
import { RemoteAgentMode } from './remote-agent.service.js';
import { MultiplexerRegistry } from './multiplexer.service.js';

const execFileAsync = promisify(execFile);
const log = pino({ name: 'session' });

interface SessionRow {
  id: string;
  name: string;
  tmux_session: string;
  workspace_path: string;
  status: string;
  type: string | null;
  skip_permissions: number;
  cli_session_id: string | null;
  backend: string | null;
  agent_hostname: string | null;
  cli_provider: string | null;
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
    type: (row.type as Session['type']) || 'cli',
    skipPermissions: row.skip_permissions === 1,
    cliSessionId: row.cli_session_id ?? undefined,
    backend: (row.backend as SessionBackend) || 'tmux',
    cliProvider: (row.cli_provider as CliProviderId) || DEFAULT_CLI_PROVIDER,
    agentHostname: row.agent_hostname ?? undefined,
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
 * Encode a Windows path to AI CLI's project folder name.
 * F:\Raphael\Backups → F--Raphael-Backups
 */
function encodeWindowsFolderName(winPath: string): string {
  const match = winPath.match(/^([A-Za-z]):\\(.*)$/);
  if (!match) return winPath;
  return `${match[1]}--${match[2].replace(/\\/g, '-')}`;
}

/**
 * Encode a WSL path to AI CLI's project folder name.
 * /mnt/f/Raphael/Backups → -mnt-f-Raphael-Backups
 * AI CLI on Linux replaces all / with - in the cwd.
 */
function encodeWslFolderName(wslPath: string): string {
  return wslPath.replace(/\//g, '-');
}

/**
 * Ensure the WSL-encoded project folder exists as a symlink to the Windows-encoded one.
 * AI CLI in WSL encodes /mnt/f/... differently than Windows encodes F:\...
 * Without this, --resume can't find sessions created by Windows-native AI CLI.
 */
async function ensureProjectSymlink(workspacePath: string, provider: import('@air-code/shared').CliProvider): Promise<void> {
  const winFolder = provider.encodeFolderName(workspacePath);
  const wslFolder = encodeWslFolderName(toWslPath(workspacePath));
  if (winFolder === wslFolder) return;

  const projectsDir = join(homedir(), provider.projectsDir);
  const winTarget = join(projectsDir, winFolder);
  const wslLink = join(projectsDir, wslFolder);

  // Only create if the Windows folder exists and the WSL link doesn't
  const winTargetExists = await fs.access(winTarget).then(() => true).catch(() => false);
  if (!winTargetExists) return;
  try {
    const stat = await fs.lstat(wslLink);
    if (stat.isSymbolicLink()) return; // already linked
    return; // exists as a real directory — don't touch
  } catch {
    // Doesn't exist — create the symlink
  }

  try {
    await fs.symlink(winTarget, wslLink, 'junction');
    log.info({ winFolder, wslFolder }, 'created project symlink for WSL path');
  } catch (err) {
    log.warn({ err, winFolder, wslFolder }, 'failed to create project symlink');
  }
}

async function tryTmux(...args: string[]): Promise<string> {
  if (IS_WINDOWS) {
    // Use bash -c to preserve tmux format strings like #{session_name}.
    // wsl.exe's default shell layer strips # characters, breaking -F arguments.
    const escaped = args.map(a => a.replace(/'/g, "'\\''"));
    const cmd = `tmux ${escaped.map(a => `'${a}'`).join(' ')}`;
    const { stdout } = await execFileAsync('wsl', ['bash', '-c', cmd]);
    return stdout;
  }
  const { stdout } = await execFileAsync('tmux', args);
  return stdout;
}

export class SessionService {
  private controllers: Map<string, IControlMode> = new Map();
  private sessionWatchers: Map<string, FSWatcher> = new Map();
  private multiplexers: MultiplexerRegistry;
  private mockMode: boolean;

  constructor(multiplexers: MultiplexerRegistry) {
    this.multiplexers = multiplexers;
    this.mockMode = true; // default until init() runs
  }

  /**
   * Async initialization — must be called after construction.
   * Sets mock mode based on tmux availability.
   */
  async init(): Promise<void> {
    this.mockMode = !(await this.checkTmux());
    if (this.mockMode) {
      log.warn('tmux not found - running in MOCK mode. Sessions will simulate terminal output.');
    }
  }

  /**
   * Check if tmux is available.
   */
  async checkTmux(): Promise<boolean> {
    try {
      await tryTmux('-V');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check which CLI providers are available on PATH and log results.
   */
  async checkCliProviders(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};
    for (const provider of getAllCliProviders()) {
      try {
        await execFileAsync(IS_WINDOWS ? 'where.exe' : 'which', [provider.binary]);
        results[provider.id] = true;
      } catch {
        results[provider.id] = false;
        log.warn({ binary: provider.binary }, `${provider.displayName} CLI not found on PATH`);
      }
    }
    return results;
  }

  get isMockMode(): boolean {
    return this.mockMode;
  }

  /**
   * Create a new AI CLI session.
   * In mock mode: no real tmux, just a simulated terminal.
   * In real mode: creates a tmux session running AI CLI CLI.
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
      const sessionType = req.type || 'cli';
      const initialCliId = req.cliResumeId || null;
      const cliProviderVal = req.cliProvider || DEFAULT_CLI_PROVIDER;
      db.prepare(`
        INSERT INTO sessions (id, name, tmux_session, workspace_path, status, type, skip_permissions, cli_session_id, backend, cli_provider)
        VALUES (?, ?, ?, ?, 'running', ?, ?, ?, 'pty', ?)
      `).run(id, req.name, tmuxName, req.workspacePath, sessionType, req.skipPermissions ? 1 : 0, initialCliId, cliProviderVal);

      this.attachPtyDirect(id, req.workspacePath, req);

      // Watch for session file on new sessions or forks (fork creates a new session ID)
      if (sessionType === 'cli' && (!initialCliId || req.forkSession)) {
        this.watchForCliSession(id, req.workspacePath, cliProviderVal);
      }

      const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow;
      log.info({ id, tmuxName, workspace: req.workspacePath, backend: 'pty' }, 'PTY session created');
      return rowToSession(row);
    }

    // ── tmux backend (existing logic) ──
    if (!this.mockMode) {
      const startDir = IS_WINDOWS ? toWslPath(req.workspacePath) : req.workspacePath;
      try {
        await tryTmux('new-session', '-d', '-s', tmuxName, '-c', startDir, '-x', '80', '-y', '24');
        try { await tryTmux('set-option', '-t', tmuxName, 'status', 'off'); } catch { /* ignore */ }
      } catch (err) {
        log.error({ err, tmuxName }, 'failed to create tmux session');
        throw new Error(`Failed to create tmux session: ${err}`);
      }

      if (req.type !== 'shell') {
        const provider = getCliProvider(req.cliProvider || DEFAULT_CLI_PROVIDER);
        const cliCmd = provider.buildCommand({
          resumeId: req.cliResumeId,
          forkSession: req.forkSession,
          skipPermissions: req.skipPermissions,
          extraArgs: req.cliArgs,
          wslHome: IS_WINDOWS ? toWslPath(homedir()) : undefined,
        });

        if (IS_WINDOWS) {
          await ensureProjectSymlink(req.workspacePath, provider);
        }

        try {
          await tryTmux('send-keys', '-t', tmuxName, cliCmd, 'Enter');
        } catch (err) {
          try { await tryTmux('kill-session', '-t', tmuxName); } catch { /* ignore */ }
          throw new Error(`Failed to start AI CLI: ${err}`);
        }
      } else {
        const startDir2 = IS_WINDOWS ? toWslPath(req.workspacePath) : req.workspacePath;
        try {
          await tryTmux('send-keys', '-t', tmuxName, `cd "${startDir2}"`, 'Enter');
        } catch { /* non-fatal */ }
      }
    }

    const sessionType = req.type || 'cli';
    const initialCliId = req.cliResumeId || null;
    const cliProviderVal = req.cliProvider || DEFAULT_CLI_PROVIDER;
    db.prepare(`
      INSERT INTO sessions (id, name, tmux_session, workspace_path, status, type, skip_permissions, cli_session_id, backend, cli_provider)
      VALUES (?, ?, ?, ?, 'running', ?, ?, ?, 'tmux', ?)
    `).run(id, req.name, tmuxName, req.workspacePath, sessionType, req.skipPermissions ? 1 : 0, initialCliId, cliProviderVal);

    this.attachControlMode(id, tmuxName);

    // Watch for CLI session ID on new sessions or forks (fork creates a new session ID)
    if (sessionType === 'cli' && (!initialCliId || req.forkSession)) {
      this.watchForCliSession(id, req.workspacePath, cliProviderVal);
    }

    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow;
    log.info({ id, tmuxName, workspace: req.workspacePath, mock: this.mockMode }, 'session created');
    return rowToSession(row);
  }

  /**
   * Spawn a direct PTY (native PowerShell) and optionally launch AI CLI inside it.
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

    // For CLI sessions, type the CLI command into the shell
    if (req && req.type !== 'shell') {
      const provider = getCliProvider(req.cliProvider || DEFAULT_CLI_PROVIDER);
      const cliCmd = provider.buildCommand({
        resumeId: req.cliResumeId,
        forkSession: req.forkSession,
        skipPermissions: req.skipPermissions,
        extraArgs: req.cliArgs,
      });

      // Small delay to let the shell prompt initialize
      setTimeout(() => {
        ctrl.sendKeys('', cliCmd + '\r');
      }, 500);
    }
  }

  /**
   * Create a remote terminal session (agent-initiated).
   */
  createRemote(info: { hostname: string; shell: string }): Session {
    const db = getDb();
    const id = uuid();
    const name = `${info.hostname} (${info.shell})`;
    const placeholder = `remote-${id.substring(0, 8)}`;

    db.prepare(`
      INSERT INTO sessions (id, name, tmux_session, workspace_path, status, type, skip_permissions, backend, agent_hostname)
      VALUES (?, ?, ?, '', 'running', 'shell', 0, 'remote', ?)
    `).run(id, name, placeholder, info.hostname);

    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow;
    log.info({ id, hostname: info.hostname, shell: info.shell }, 'remote session created');
    return rowToSession(row);
  }

  /**
   * Attach a remote agent WebSocket to a session.
   */
  attachRemoteAgent(sessionId: string, ws: import('ws').WebSocket): void {
    const ctrl = new RemoteAgentMode();
    this.controllers.set(sessionId, ctrl);

    const mux = this.multiplexers.getOrCreate(sessionId);

    ctrl.on('output', (_paneId: string, data: string) => {
      mux.broadcast(data);
      this.updateActivity(sessionId);
    });

    ctrl.on('detached', () => {
      log.info({ sessionId }, 'remote agent detached');
      this.controllers.delete(sessionId);
      this.updateStatus(sessionId, 'stopped');
    });

    ctrl.on('error', (err: Error) => {
      log.error({ err, sessionId }, 'remote agent error');
    });

    ctrl.attach(ws);
  }

  /**
   * Watch ~/.claude/projects/<folder>/ for a new .jsonl file using fs.watch.
   * Snapshot existing files first, then wait for a new one to appear.
   * Event-driven — no race condition, no polling.
   */
  private async watchForCliSession(sessionId: string, workspacePath: string, cliProviderId?: CliProviderId): Promise<void> {
    try {
      const provider = getCliProvider(cliProviderId || DEFAULT_CLI_PROVIDER);
      const projectFolder = provider.encodeFolderName(workspacePath);
      const projectDir = join(homedir(), provider.projectsDir, projectFolder);
      const ext = provider.sessionFileExt;

      // Ensure the directory exists (The CLI may not have created it yet)
      const dirExists = await fs.access(projectDir).then(() => true).catch(() => false);
      if (!dirExists) {
        await fs.mkdir(projectDir, { recursive: true });
      }

      // Snapshot existing session files so we can detect the new one
      const files = await fs.readdir(projectDir);
      const existing = new Set(
        files.filter(f => f.endsWith(ext))
      );

      const watcher = watch(projectDir, (eventType, filename) => {
        if (!filename || !filename.endsWith(ext)) return;
        if (existing.has(filename)) return;

        // New session file — this is the CLI session ID
        const cliSessionId = filename.replace(ext, '');
        const db = getDb();
        db.prepare('UPDATE sessions SET cli_session_id = ? WHERE id = ?')
          .run(cliSessionId, sessionId);
        log.info({ sessionId, cliSessionId }, 'detected CLI session ID via fs.watch');

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
          log.warn({ sessionId }, 'CLI session ID detection timed out');
        }
      }, 60000);
    } catch (err) {
      log.warn({ err, sessionId }, 'failed to set up fs.watch for CLI session detection');
    }
  }

  private attachControlMode(sessionId: string, tmuxName: string): void {
    const ctrl = this.mockMode
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

  async list(): Promise<Session[]> {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM sessions ORDER BY created_at DESC').all() as SessionRow[];

    const sessions: Session[] = [];
    for (const row of rows) {
      const session = rowToSession(row);
      if (session.status === 'running' || session.status === 'idle') {
        if (session.backend === 'pty' || session.backend === 'remote') {
          // PTY/Remote sessions: alive only if controller exists
          if (!this.controllers.has(session.id)) {
            this.updateStatus(session.id, 'stopped');
            session.status = 'stopped';
          }
        } else if (!this.mockMode) {
          if (!(await this.isTmuxSessionAlive(session.tmuxSession))) {
            this.updateStatus(session.id, 'stopped');
            session.status = 'stopped';
          }
        }
      }
      sessions.push(session);
    }
    return sessions;
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

    if (session.backend === 'pty' || session.backend === 'remote') {
      // Direct PTY or remote — just kill the controller
      const ctrl = this.controllers.get(id);
      if (ctrl) {
        ctrl.detach();
        this.controllers.delete(id);
      }
    } else {
      // tmux — Kill tmux FIRST so the PTY exits naturally (avoids ConPTY AttachConsole error on Windows)
      if (!this.mockMode) {
        try {
          await tryTmux('kill-session', '-t', session.tmuxSession);
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
    } else if (session.backend !== 'pty' && session.backend !== 'remote' && !this.mockMode) {
      await tryTmux('send-keys', '-t', session.tmuxSession, keys);
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
        return await tryTmux('capture-pane', '-t', session.tmuxSession, '-p', '-S', `-${lines}`);
      } catch {
        return '';
      }
    }

    return `[Mock session: ${session.name}]\n`;
  }

  /**
   * Re-attach control mode to a session whose streaming may have died.
   */
  async reattach(id: string): Promise<Session | null> {
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
        cliResumeId: session.cliSessionId,
        cliProvider: session.cliProvider,
      };
      this.attachPtyDirect(id, session.workspacePath, req);
      log.info({ id, cliResumeId: session.cliSessionId }, 'reattached PTY session');
      return this.get(id);
    }

    if (this.mockMode) return session;

    // Check tmux session is alive
    if (!(await this.isTmuxSessionAlive(session.tmuxSession))) {
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
  async reattachAll(): Promise<void> {
    const sessions = (await this.list()).filter((s) => s.status === 'running' || s.status === 'idle');
    log.info({ count: sessions.length, mock: this.mockMode }, 'sessions available for lazy reattach');
  }

  /**
   * Lazily attach PTY control mode to a session.
   * Called when the first WebSocket client connects to a terminal.
   * No-op if already attached or session is not running.
   */
  async ensureAttached(sessionId: string): Promise<void> {
    if (this.controllers.has(sessionId)) return;

    const session = this.get(sessionId);
    if (!session) return;

    if (session.backend === 'remote') {
      // Remote sessions reconnect via agent — nothing to do server-side
      return;
    }

    if (session.backend === 'pty') {
      // PTY reconnect: spawn a new PTY for stopped sessions
      if (session.status === 'stopped') {
        this.updateStatus(sessionId, 'running');
        const req: CreateSessionRequest = {
          name: session.name,
          workspacePath: session.workspacePath,
          type: session.type,
          skipPermissions: session.skipPermissions,
          cliResumeId: session.cliSessionId,
          cliProvider: session.cliProvider,
        };
        this.attachPtyDirect(sessionId, session.workspacePath, req);
        log.info({ id: sessionId, cliResumeId: session.cliSessionId }, 'reconnected PTY session');
      }
      return;
    }

    // tmux backend
    if (this.mockMode) return;
    if (session.status !== 'running' && session.status !== 'idle') return;

    if (!(await this.isTmuxSessionAlive(session.tmuxSession))) {
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
  async cleanupOrphans(): Promise<void> {
    // Mark all PTY and remote sessions as stopped — they can't survive SMS restart
    const db0 = getDb();
    const ptyMarked = db0.prepare(
      `UPDATE sessions SET status = 'stopped' WHERE backend IN ('pty', 'remote') AND status IN ('running', 'idle')`
    ).run();
    if (ptyMarked.changes > 0) {
      log.info({ count: ptyMarked.changes }, 'marked PTY/remote sessions as stopped (SMS restart)');
    }

    if (this.mockMode) return;

    // 1. Get all alive cca-* tmux sessions
    let aliveSessions: string[];
    try {
      const output = await tryTmux('list-sessions', '-F', '#{session_name}');
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
          workspacePath = (await tryTmux(
            'display-message', '-t', tmuxName, '-p', '#{pane_current_path}',
          )).trim();
          // WSL returns /mnt/c/... paths — convert back to Windows C:\...
          if (IS_WINDOWS) workspacePath = fromWslPath(workspacePath);
        } catch { /* fallback to empty */ }

        // Ensure tmux status bar is off for recovered sessions
        try { await tryTmux('set-option', '-t', tmuxName, 'status', 'off'); } catch { /* ignore */ }

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

    // 4. Mark DB sessions whose tmux is dead as stopped (preserves metadata for reopen)
    const aliveSet = new Set(aliveSessions);
    let stopped = 0;
    for (const row of dbRows) {
      if (!aliveSet.has(row.tmux_session) && row.status !== 'stopped') {
        db.prepare("UPDATE sessions SET status = 'stopped' WHERE id = ?").run(row.id);
        stopped++;
        log.info({ id: row.id, tmux: row.tmux_session }, 'marked dead tmux session as stopped');
      }
    }

    // 5. Strip "(recovered)" suffix from session names (legacy cleanup)
    db.prepare(`UPDATE sessions SET name = REPLACE(name, ' (recovered)', '') WHERE name LIKE '% (recovered)'`).run();

    if (adopted > 0 || stopped > 0) {
      log.info({ adopted, stopped }, 'session reconciliation complete');
    }
  }

  /**
   * Reopen a stopped session by creating a fresh tmux/PTY process
   * using the original session metadata. Reuses the same DB row ID
   * so the canvas node stays in place.
   */
  async reopen(id: string, cliArgs?: string): Promise<Session> {
    const db = getDb();
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
    if (!row) throw new Error('Session not found');
    if (row.status !== 'stopped') throw new Error('Session is not stopped');

    const session = rowToSession(row);
    const backend = session.backend || 'tmux';
    const cwd = session.workspacePath;

    if (backend === 'pty') {
      // PTY backend — spawn a new PTY process
      const newPtyName = `pty-${uuid().substring(0, 8)}`;
      const req: CreateSessionRequest = {
        name: session.name,
        workspacePath: cwd,
        type: session.type,
        skipPermissions: session.skipPermissions,
        cliResumeId: session.cliSessionId,
        cliArgs,
        cliProvider: session.cliProvider,
      };
      this.attachPtyDirect(id, cwd, req);

      db.prepare(
        "UPDATE sessions SET tmux_session = ?, status = 'running', last_activity = datetime('now') WHERE id = ?"
      ).run(newPtyName, id);

      if (session.type === 'cli') {
        this.watchForCliSession(id, cwd, session.cliProvider);
      }

      log.info({ id, backend: 'pty', cliResumeId: session.cliSessionId }, 'reopened PTY session');
      return this.get(id)!;
    }

    // tmux backend — create a new tmux session
    if (this.mockMode) throw new Error('Cannot reopen in mock mode');

    const newTmuxName = `${TMUX_SESSION_PREFIX}${uuid().substring(0, 8)}`;
    const startDir = IS_WINDOWS ? toWslPath(cwd) : cwd;

    try {
      await tryTmux('new-session', '-d', '-s', newTmuxName, '-c', startDir, '-x', '80', '-y', '24');
      try { await tryTmux('set-option', '-t', newTmuxName, 'status', 'off'); } catch { /* ignore */ }
    } catch (err) {
      throw new Error(`Failed to create tmux session: ${err}`);
    }

    if (session.type !== 'shell') {
      const provider = getCliProvider(session.cliProvider || DEFAULT_CLI_PROVIDER);
      const cliCmd = provider.buildCommand({
        resumeId: session.cliSessionId,
        skipPermissions: session.skipPermissions,
        extraArgs: cliArgs,
        wslHome: IS_WINDOWS ? toWslPath(homedir()) : undefined,
      });

      if (IS_WINDOWS) {
        await ensureProjectSymlink(cwd, provider);
      }

      try {
        await tryTmux('send-keys', '-t', newTmuxName, cliCmd, 'Enter');
      } catch (err) {
        try { await tryTmux('kill-session', '-t', newTmuxName); } catch { /* ignore */ }
        throw new Error(`Failed to start AI CLI: ${err}`);
      }
    } else {
      const shellDir = IS_WINDOWS ? toWslPath(cwd) : cwd;
      try {
        await tryTmux('send-keys', '-t', newTmuxName, `cd "${shellDir}"`, 'Enter');
      } catch { /* non-fatal */ }
    }

    db.prepare(
      "UPDATE sessions SET tmux_session = ?, status = 'running', last_activity = datetime('now') WHERE id = ?"
    ).run(newTmuxName, id);

    this.attachControlMode(id, newTmuxName);

    if (session.type === 'cli') {
      this.watchForCliSession(id, cwd, session.cliProvider);
    }

    log.info({ id, tmuxName: newTmuxName, cliResumeId: session.cliSessionId }, 'reopened tmux session');
    return this.get(id)!;
  }

  getController(id: string): IControlMode | undefined {
    return this.controllers.get(id);
  }

  private async isTmuxSessionAlive(tmuxName: string): Promise<boolean> {
    try {
      await tryTmux('has-session', '-t', tmuxName);
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
