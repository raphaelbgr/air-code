import { execFileSync } from 'node:child_process';
import { v4 as uuid } from 'uuid';
import pino from 'pino';
import type { Session, CreateSessionRequest } from '@claude-air/shared';
import { TMUX_SESSION_PREFIX } from '@claude-air/shared';
import { getDb } from '../db/index.js';
import { TmuxControlMode } from './tmux-control.service.js';
import { MockTmuxControlMode } from './mock-tmux.service.js';
import { MultiplexerRegistry } from './multiplexer.service.js';

const log = pino({ name: 'session' });

type ControlMode = TmuxControlMode | MockTmuxControlMode;

interface SessionRow {
  id: string;
  name: string;
  tmux_session: string;
  workspace_path: string;
  status: string;
  type: string | null;
  skip_permissions: number;
  claude_session_id: string | null;
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
    createdAt: row.created_at,
    lastActivity: row.last_activity,
  };
}

const IS_WINDOWS = process.platform === 'win32';

function tryTmux(...args: string[]): string {
  if (IS_WINDOWS) {
    return execFileSync('wsl', ['tmux', ...args], { stdio: 'pipe' }).toString();
  }
  return execFileSync('tmux', args, { stdio: 'pipe' }).toString();
}

export class SessionService {
  private controllers: Map<string, ControlMode> = new Map();
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
    const tmuxName = `${TMUX_SESSION_PREFIX}${id.substring(0, 8)}`;

    if (!this.mockMode) {
      // Real tmux
      try {
        tryTmux('new-session', '-d', '-s', tmuxName, '-c', req.workspacePath, '-x', '80', '-y', '24');
        // Disable tmux status bar — it wastes space especially in mini previews
        try { tryTmux('set-option', '-t', tmuxName, 'status', 'off'); } catch { /* ignore */ }
      } catch (err) {
        log.error({ err, tmuxName }, 'failed to create tmux session');
        throw new Error(`Failed to create tmux session: ${err}`);
      }

      // Shell sessions: leave the bare shell prompt. Claude sessions: launch claude CLI.
      if (req.type !== 'shell') {
        let claudeCmd = 'claude';
        if (req.claudeResumeId) {
          claudeCmd += ` --resume ${req.claudeResumeId}`;
        } else {
          claudeCmd += ` --resume ${tmuxName}`;
        }
        if (req.skipPermissions) claudeCmd += ' --dangerously-skip-permissions';
        if (req.claudeArgs) claudeCmd += ` ${req.claudeArgs}`;

        try {
          tryTmux('send-keys', '-t', tmuxName, claudeCmd, 'Enter');
        } catch (err) {
          try { tryTmux('kill-session', '-t', tmuxName); } catch { /* ignore */ }
          throw new Error(`Failed to start Claude Code: ${err}`);
        }
      }
    }

    // Persist in DB
    const sessionType = req.type || 'claude';
    db.prepare(`
      INSERT INTO sessions (id, name, tmux_session, workspace_path, status, type, skip_permissions, claude_session_id)
      VALUES (?, ?, ?, ?, 'running', ?, ?, ?)
    `).run(id, req.name, tmuxName, req.workspacePath, sessionType, req.skipPermissions ? 1 : 0, tmuxName);

    // Attach control mode (real or mock)
    this.attachControlMode(id, tmuxName);

    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow;
    log.info({ id, tmuxName, workspace: req.workspacePath, mock: this.mockMode }, 'session created');
    return rowToSession(row);
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
      if (!this.mockMode && (session.status === 'running' || session.status === 'idle')) {
        if (!this.isTmuxSessionAlive(session.tmuxSession)) {
          this.updateStatus(session.id, 'stopped');
          session.status = 'stopped';
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

    const ctrl = this.controllers.get(id);
    if (ctrl) {
      ctrl.detach();
      this.controllers.delete(id);
    }

    if (!this.mockMode) {
      try {
        tryTmux('kill-session', '-t', session.tmuxSession);
      } catch { /* Session may already be dead */ }
    }

    this.multiplexers.remove(id);
    this.updateStatus(id, 'stopped');
    log.info({ id }, 'session killed');
  }

  async sendKeys(id: string, keys: string): Promise<void> {
    const session = this.get(id);
    if (!session) throw new Error('Session not found');

    const ctrl = this.controllers.get(id);
    if (ctrl?.attached) {
      await ctrl.sendKeys(session.tmuxSession, keys);
    } else if (!this.mockMode) {
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

  reattachAll(): void {
    const sessions = this.list().filter((s) => s.status === 'running' || s.status === 'idle');
    for (const session of sessions) {
      if (!this.controllers.has(session.id)) {
        this.attachControlMode(session.id, session.tmuxSession);
      }
    }
    log.info({ count: sessions.length, mock: this.mockMode }, 'reattached control mode to running sessions');
  }

  /**
   * Clean up orphan tmux sessions that aren't tracked in the DB,
   * and mark DB sessions as stopped if their tmux session is dead.
   */
  cleanupOrphans(): void {
    if (this.mockMode) return;

    // 1. Get all alive cca-* tmux sessions
    let aliveSessions: string[];
    try {
      const output = tryTmux('list-sessions', '-F', '#{session_name}');
      aliveSessions = output.trim().split('\n')
        .map(s => s.trim())
        .filter(s => s.startsWith(TMUX_SESSION_PREFIX));
    } catch {
      // No tmux sessions at all
      aliveSessions = [];
    }

    // 2. Get all tracked tmux session names from DB
    const db = getDb();
    const dbRows = db.prepare(
      "SELECT id, tmux_session, status FROM sessions WHERE status IN ('running', 'idle')"
    ).all() as { id: string; tmux_session: string; status: string }[];
    const trackedNames = new Set(dbRows.map(r => r.tmux_session));

    // 3. Kill tmux sessions not tracked in DB
    let killed = 0;
    for (const tmuxName of aliveSessions) {
      if (!trackedNames.has(tmuxName)) {
        try {
          tryTmux('kill-session', '-t', tmuxName);
          killed++;
          log.info({ tmuxName }, 'killed orphan tmux session');
        } catch (err) {
          log.warn({ err, tmuxName }, 'failed to kill orphan tmux session');
        }
      }
    }

    // 4. Mark DB sessions as stopped if their tmux session is dead
    const aliveSet = new Set(aliveSessions);
    let marked = 0;
    for (const row of dbRows) {
      if (!aliveSet.has(row.tmux_session)) {
        this.updateStatus(row.id, 'stopped');
        marked++;
        log.info({ id: row.id, tmux: row.tmux_session }, 'marked dead session as stopped');
      }
    }

    if (killed > 0 || marked > 0) {
      log.info({ killed, marked }, 'orphan cleanup complete');
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
