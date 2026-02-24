import { EventEmitter } from 'node:events';
import pino from 'pino';
import type { PaneInfo } from '../types.js';

const log = pino({ name: 'mock-tmux' });

/**
 * Mock TmuxControlMode for development on systems without tmux (Windows).
 * Simulates terminal output with periodic fake messages.
 */
export class MockTmuxControlMode extends EventEmitter {
  private interval: ReturnType<typeof setInterval> | null = null;
  private _attached = false;
  private sessionName = '';

  get attached(): boolean {
    return this._attached;
  }

  attach(sessionName: string): void {
    this.sessionName = sessionName;
    this._attached = true;

    // Simulate initial output after a short delay
    setTimeout(() => {
      this.emit('output', '%0', `\r\n\x1b[1;34m[mock]\x1b[0m Claude Code session "${sessionName}" (mock mode - tmux not available)\r\n`);
      this.emit('output', '%0', `\x1b[1;34m[mock]\x1b[0m Type commands below. They will be echoed back.\r\n`);
      this.emit('output', '%0', `\x1b[32m$ \x1b[0m`);
    }, 500);

    this.emit('ready');
    log.info({ sessionName }, 'mock control mode attached');
  }

  async sendCommand(command: string): Promise<string> {
    log.debug({ command }, 'mock sendCommand');
    return '';
  }

  async sendKeys(target: string, keys: string): Promise<void> {
    // Echo keys back as output
    setTimeout(() => {
      this.emit('output', '%0', keys);
      // If Enter, simulate a prompt
      if (keys.includes('Enter') || keys === '\r') {
        setTimeout(() => {
          this.emit('output', '%0', `\r\n\x1b[2m(mock echo)\x1b[0m\r\n\x1b[32m$ \x1b[0m`);
        }, 100);
      }
    }, 50);
  }

  async sendKeysLiteral(target: string, text: string): Promise<void> {
    await this.sendKeys(target, text);
  }

  async resizePane(_paneId: string, cols: number, rows: number): Promise<void> {
    log.debug({ cols, rows }, 'mock resizePane');
  }

  async capturePaneContent(_paneId: string, _lines = 100): Promise<string> {
    return `[Mock session: ${this.sessionName}]\nThis is a mock terminal. tmux is not available.\n`;
  }

  async listPanes(_sessionName?: string): Promise<PaneInfo[]> {
    return [{
      id: '%0',
      sessionName: this.sessionName,
      windowIndex: 0,
      paneIndex: 0,
      width: 200,
      height: 50,
      active: true,
    }];
  }

  detach(): void {
    this._attached = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.emit('detached');
    log.info('mock control mode detached');
  }
}
