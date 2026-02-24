import { WebSocket } from 'ws';
import pino from 'pino';
import { config } from '../config.js';

const log = pino({ name: 'multiplexer' });

/**
 * Circular buffer for scrollback history.
 */
class CircularBuffer {
  private buffer: string[];
  private head = 0;
  private size = 0;
  private readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }

  push(line: string): void {
    this.buffer[this.head] = line;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
  }

  getAll(): string[] {
    if (this.size < this.capacity) {
      return this.buffer.slice(0, this.size);
    }
    // Buffer is full - read from head (oldest) to end, then start to head
    return [
      ...this.buffer.slice(this.head),
      ...this.buffer.slice(0, this.head),
    ];
  }

  clear(): void {
    this.head = 0;
    this.size = 0;
  }
}

export interface MultiplexerClient {
  ws: WebSocket;
  clientId: string;
  isLeader: boolean; // first connected client determines resize
  isPreview: boolean; // mini terminal previews (shouldn't control size when full panels exist)
}

/**
 * Manages WebSocket fan-out for a single tmux session.
 * One multiplexer per session. Output goes to ALL clients,
 * input from ANY client goes to tmux.
 */
export class SessionMultiplexer {
  readonly sessionId: string;
  private clients: Map<string, MultiplexerClient> = new Map();
  private scrollback: CircularBuffer;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.scrollback = new CircularBuffer(config.maxScrollback);
  }

  get clientCount(): number {
    return this.clients.size;
  }

  /**
   * Add a WebSocket client to this multiplexer.
   * Sends scrollback buffer as initial data unless skipScrollback is set
   * (used by mini preview terminals that resize immediately — old scrollback
   * contains escape codes for a different terminal size and causes blank rows).
   */
  addClient(clientId: string, ws: WebSocket, skipScrollback = false): void {
    const isLeader = this.clients.size === 0;
    this.clients.set(clientId, { ws, clientId, isLeader, isPreview: skipScrollback });

    // Send scrollback to new client (unless preview mode)
    if (!skipScrollback) {
      const history = this.scrollback.getAll();
      if (history.length > 0) {
        const payload = JSON.stringify({
          type: 'terminal:data',
          sessionId: this.sessionId,
          data: history.join(''),
        });
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(payload);
        }
      }
    }

    log.info({ sessionId: this.sessionId, clientId, isLeader, skipScrollback }, 'client added to multiplexer');
  }

  /**
   * Remove a client.
   */
  removeClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;
    this.clients.delete(clientId);

    // Reassign leader if needed
    if (client.isLeader && this.clients.size > 0) {
      const first = this.clients.values().next().value!;
      first.isLeader = true;
    }

    log.info({ sessionId: this.sessionId, clientId }, 'client removed from multiplexer');
  }

  /**
   * Broadcast terminal output data to all connected clients.
   */
  broadcast(data: string): void {
    this.scrollback.push(data);
    if (this.clients.size > 0) {
      log.debug({ sessionId: this.sessionId, clients: this.clients.size, bytes: data.length }, 'broadcasting data');
    }
    const payload = JSON.stringify({
      type: 'terminal:data',
      sessionId: this.sessionId,
      data,
    });

    for (const [clientId, client] of this.clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(payload);
      } else {
        this.clients.delete(clientId);
      }
    }
  }

  /**
   * Get the leader client (for resize decisions).
   */
  getLeader(): MultiplexerClient | undefined {
    for (const client of this.clients.values()) {
      if (client.isLeader) return client;
    }
    return undefined;
  }

  /**
   * Check if a client is connected.
   */
  hasClient(clientId: string): boolean {
    return this.clients.has(clientId);
  }

  /**
   * Whether a non-preview (full panel) client is connected.
   * Preview terminals yield resize control to full panels.
   */
  hasFullPanelClient(): boolean {
    for (const client of this.clients.values()) {
      if (!client.isPreview) return true;
    }
    return false;
  }

  /**
   * Check if a specific client is a preview client.
   */
  isPreviewClient(clientId: string): boolean {
    return this.clients.get(clientId)?.isPreview ?? false;
  }

  /**
   * Get all connected client IDs.
   */
  getClientIds(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Clear all clients and scrollback.
   */
  destroy(): void {
    for (const client of this.clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.close(4000, 'session destroyed');
      }
    }
    this.clients.clear();
    this.scrollback.clear();
  }
}

/**
 * Global registry of session multiplexers.
 */
export class MultiplexerRegistry {
  private multiplexers: Map<string, SessionMultiplexer> = new Map();

  get(sessionId: string): SessionMultiplexer | undefined {
    return this.multiplexers.get(sessionId);
  }

  getOrCreate(sessionId: string): SessionMultiplexer {
    let mux = this.multiplexers.get(sessionId);
    if (!mux) {
      mux = new SessionMultiplexer(sessionId);
      this.multiplexers.set(sessionId, mux);
    }
    return mux;
  }

  remove(sessionId: string): void {
    const mux = this.multiplexers.get(sessionId);
    if (mux) {
      mux.destroy();
      this.multiplexers.delete(sessionId);
    }
  }

  getAll(): SessionMultiplexer[] {
    return Array.from(this.multiplexers.values());
  }
}
