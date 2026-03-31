import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';
import pino from 'pino';
import type { WsMessage } from '@air-code/shared';
import type { IControlMode } from './control-mode.interface.js';

const log = pino({ name: 'remote-agent' });

export interface RemoteAgentMode {
  on(event: 'output', handler: (paneId: string, data: string) => void): this;
  on(event: 'error', handler: (error: Error) => void): this;
  on(event: 'detached', handler: () => void): this;
  on(event: 'ready', handler: () => void): this;
}

/**
 * Remote agent mode — the PTY lives on the client's machine.
 * The agent connects via WebSocket and streams I/O.
 * Same EventEmitter interface as TmuxControlMode / PtyDirectMode.
 */
export class RemoteAgentMode extends EventEmitter implements IControlMode {
  private agentWs: WebSocket | null = null;
  private _attached = false;

  get attached(): boolean {
    return this._attached;
  }

  /**
   * Attach an incoming agent WebSocket as the I/O source.
   */
  attach(ws: WebSocket): void {
    if (this.agentWs) {
      throw new Error('Already attached. Call detach() first.');
    }

    this.agentWs = ws;
    this._attached = true;

    ws.on('message', (raw) => {
      try {
        const msg: WsMessage = JSON.parse(raw.toString());
        if (msg.type === 'terminal:data' && msg.data) {
          this.emit('output', '', msg.data);
        }
      } catch (err) {
        log.error({ err }, 'error parsing agent message');
      }
    });

    ws.on('close', () => {
      log.info('remote agent disconnected');
      this._attached = false;
      this.agentWs = null;
      this.emit('detached');
    });

    ws.on('error', (err) => {
      log.error({ err }, 'remote agent ws error');
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    });

    this.emit('ready');
    log.info('remote agent attached');
  }

  /**
   * Send keystrokes to the agent's PTY.
   */
  async sendKeys(_target: string, keys: string): Promise<void> {
    if (this.agentWs && this.agentWs.readyState === WebSocket.OPEN) {
      this.agentWs.send(JSON.stringify({
        type: 'terminal:input',
        sessionId: '',
        data: keys,
      }));
    }
  }

  /**
   * Send resize command to the agent's PTY.
   */
  async resizePane(_paneId: string, cols: number, rows: number): Promise<void> {
    if (this.agentWs && this.agentWs.readyState === WebSocket.OPEN) {
      this.agentWs.send(JSON.stringify({
        type: 'terminal:resize',
        sessionId: '',
        cols,
        rows,
      }));
    }
  }

  /**
   * No server-side capture for remote terminals.
   */
  async capturePaneContent(_sessionName?: string, _lines?: number): Promise<string> {
    return '';
  }

  /**
   * Close the agent WebSocket.
   */
  detach(): void {
    if (this.agentWs) {
      try {
        this.agentWs.close();
      } catch { /* already closed */ }
      this.agentWs = null;
    }
    this._attached = false;
  }
}
