import { EventEmitter } from 'node:events';
import * as pty from 'node-pty';
import pino from 'pino';

const log = pino({ name: 'tmux-control' });
const IS_WINDOWS = process.platform === 'win32';

/**
 * Get the shell and args to spawn `tmux attach-session` via node-pty.
 * On Windows we go through WSL; on Linux/macOS we call tmux directly.
 */
function tmuxAttachCommand(sessionName: string): { shell: string; args: string[] } {
  if (IS_WINDOWS) {
    return { shell: 'wsl.exe', args: ['tmux', 'attach-session', '-t', sessionName] };
  }
  return { shell: 'tmux', args: ['attach-session', '-t', sessionName] };
}

export interface TmuxControlMode {
  on(event: 'output', handler: (paneId: string, data: string) => void): this;
  on(event: 'error', handler: (error: Error) => void): this;
  on(event: 'detached', handler: () => void): this;
  on(event: 'ready', handler: () => void): this;
}

/**
 * PTY-based tmux session bridge using node-pty.
 *
 * Instead of tmux control mode (-CC) which requires protocol parsing,
 * this spawns `tmux attach-session` inside a real PTY. The raw terminal
 * output goes straight to xterm.js in the browser — no translation needed.
 * Both speak the same language: ANSI escape sequences.
 */
export class TmuxControlMode extends EventEmitter {
  private ptyProcess: pty.IPty | null = null;
  private _attached = false;

  get attached(): boolean {
    return this._attached;
  }

  /**
   * Attach to an existing tmux session via a real PTY.
   */
  attach(sessionName: string, cols = 80, rows = 24): void {
    if (this.ptyProcess) {
      throw new Error('Already attached. Call detach() first.');
    }

    const { shell, args } = tmuxAttachCommand(sessionName);

    try {
      this.ptyProcess = pty.spawn(shell, args, {
        name: 'xterm-256color',
        cols,
        rows,
        env: { ...process.env, TERM: 'xterm-256color' },
      });
    } catch (err) {
      log.error({ err, sessionName }, 'failed to spawn PTY for tmux attach');
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
      return;
    }

    this._attached = true;

    let totalBytes = 0;
    this.ptyProcess.onData((data: string) => {
      totalBytes += data.length;
      if (totalBytes <= data.length) {
        log.info({ sessionName, bytes: data.length }, 'first PTY data chunk received');
      }
      this.emit('output', '', data);
    });

    this.ptyProcess.onExit(({ exitCode }) => {
      // exitCode -1073741510 (0xC000013A) = STATUS_CONTROL_C_EXIT on Windows
      // This is normal when killing a session — the ConPTY agent fails to
      // attach to the already-dead console process. Suppress the error.
      if (exitCode === -1073741510) {
        log.debug({ exitCode, sessionName }, 'PTY exited (control-C / session killed)');
      } else {
        log.info({ exitCode, sessionName }, 'PTY exited');
      }
      this._attached = false;
      this.ptyProcess = null;
      this.emit('detached');
    });

    this.emit('ready');
    log.info({ sessionName, pid: this.ptyProcess.pid, cols, rows }, 'attached to tmux session via node-pty');
  }

  /**
   * Send raw keystrokes to the PTY (goes straight to tmux → shell).
   * The `target` parameter is ignored — node-pty writes to the attached session directly.
   */
  async sendKeys(_target: string, keys: string): Promise<void> {
    if (this.ptyProcess) {
      this.ptyProcess.write(keys);
    }
  }

  /**
   * Resize the PTY. tmux auto-detects the resize and adjusts its panes.
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
   * Capture pane content via tmux capture-pane (fallback for REST API).
   * This runs a separate one-shot command, not through the PTY.
   */
  async capturePaneContent(sessionName: string, lines = 100): Promise<string> {
    const { execFileSync } = await import('node:child_process');
    try {
      const args = IS_WINDOWS
        ? ['tmux', 'capture-pane', '-t', sessionName, '-p', '-S', `-${lines}`]
        : ['capture-pane', '-t', sessionName, '-p', '-S', `-${lines}`];
      const cmd = IS_WINDOWS ? 'wsl' : 'tmux';
      return execFileSync(cmd, args, { stdio: 'pipe' }).toString();
    } catch {
      return '';
    }
  }

  /**
   * Detach from the tmux session by killing the PTY process.
   * The tmux session itself stays alive.
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
