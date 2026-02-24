import { EventEmitter } from 'node:events';
import * as pty from 'node-pty';
import pino from 'pino';

const log = pino({ name: 'pty-direct' });
const IS_WINDOWS = process.platform === 'win32';

export interface PtyDirectMode {
  on(event: 'output', handler: (paneId: string, data: string) => void): this;
  on(event: 'error', handler: (error: Error) => void): this;
  on(event: 'detached', handler: () => void): this;
  on(event: 'ready', handler: () => void): this;
}

/**
 * Direct PTY mode — spawns a native shell (powershell.exe / bash) without tmux.
 * Same EventEmitter interface as TmuxControlMode so SessionService can use either.
 */
export class PtyDirectMode extends EventEmitter {
  private ptyProcess: pty.IPty | null = null;
  private _attached = false;

  get attached(): boolean {
    return this._attached;
  }

  /**
   * Spawn a native shell PTY in the given working directory.
   */
  attach(cwd: string, cols = 80, rows = 24): void {
    if (this.ptyProcess) {
      throw new Error('Already attached. Call detach() first.');
    }

    const shell = IS_WINDOWS ? 'powershell.exe' : 'bash';

    try {
      this.ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: { ...process.env, TERM: 'xterm-256color' },
      });
    } catch (err) {
      log.error({ err, cwd, shell }, 'failed to spawn direct PTY');
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
      return;
    }

    this._attached = true;

    this.ptyProcess.onData((data: string) => {
      this.emit('output', '', data);
    });

    this.ptyProcess.onExit(({ exitCode }) => {
      log.info({ exitCode, cwd }, 'direct PTY exited');
      this._attached = false;
      this.ptyProcess = null;
      this.emit('detached');
    });

    this.emit('ready');
    log.info({ cwd, shell, pid: this.ptyProcess.pid, cols, rows }, 'direct PTY spawned');
  }

  /**
   * Send raw keystrokes to the PTY.
   * The `target` parameter is ignored (compatibility with TmuxControlMode).
   */
  async sendKeys(_target: string, keys: string): Promise<void> {
    if (this.ptyProcess) {
      this.ptyProcess.write(keys);
    }
  }

  /**
   * Resize the PTY.
   */
  async resizePane(_paneId: string, cols: number, rows: number): Promise<void> {
    if (this.ptyProcess) {
      try {
        this.ptyProcess.resize(cols, rows);
      } catch (err) {
        log.warn({ err }, 'resize failed');
      }
    }
  }

  /**
   * No tmux capture available — return empty string.
   */
  async capturePaneContent(_sessionName?: string, _lines?: number): Promise<string> {
    return '';
  }

  /**
   * Kill the PTY process. Unlike tmux detach, this destroys the session.
   */
  detach(): void {
    if (this.ptyProcess) {
      try {
        this.ptyProcess.kill();
      } catch { /* already dead */ }
      this.ptyProcess = null;
    }
    this._attached = false;
  }
}
