import type { WsMessage } from '@claude-air/shared';

type DataHandler = (data: string) => void;
type ConnectionHandler = (connected: boolean) => void;

interface Subscription {
  onData: DataHandler;
  preview?: boolean;
  orphaned?: boolean;
}

/**
 * Singleton multiplexed WebSocket channel for all terminal I/O.
 * One WS connection to WAS at /ws/terminals, messages routed by sessionId.
 */
class TerminalChannel {
  private ws: WebSocket | null = null;
  private pendingWs: WebSocket | null = null; // tracks WS during CONNECTING state
  private token: string | null = null;
  private subscriptions = new Map<string, Subscription>();
  private connectionHandlers = new Set<ConnectionHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private _connected = false;
  private generation = 0; // incremented on each connect/disconnect to invalidate stale WSs
  private pendingUnsubs = new Map<string, ReturnType<typeof setTimeout>>();

  get connected(): boolean {
    return this._connected;
  }

  /** Open the multiplexed WS (call once on login). */
  connect(token: string): void {
    if (this.ws && this.token === token) return; // already connected with same token
    // Close any existing or pending connection first
    this.closeAllWs();
    this.token = token;
    this.generation++;
    this.openWs();
  }

  /** Close the WS (call on logout). */
  disconnect(): void {
    this.clearReconnect();
    this.generation++;
    this.closeAllWs();
    // Clear pending unsubscribe timers
    for (const timer of this.pendingUnsubs.values()) clearTimeout(timer);
    this.pendingUnsubs.clear();
    // NOTE: don't clear subscriptions — they survive disconnect/reconnect
    // so that onopen can re-subscribe. React effects manage the subscription lifecycle.
    this.setConnected(false);
    this.token = null;
  }

  /** Subscribe to terminal data for a session. Returns unsubscribe fn. */
  subscribe(sessionId: string, onData: DataHandler, opts?: { preview?: boolean }): () => void {
    // Check for tier-switch: an orphaned subscription from a component that just unmounted
    const pending = this.pendingUnsubs.get(sessionId);
    const existing = this.subscriptions.get(sessionId);

    if (pending && existing?.orphaned) {
      // Tier switch — cancel the deferred unsubscribe, reuse server subscription
      clearTimeout(pending);
      this.pendingUnsubs.delete(sessionId);
      existing.onData = onData;
      existing.preview = opts?.preview;
      existing.orphaned = false;
      // No server message needed — subscription is still active on server
      return () => this.unsubscribe(sessionId);
    }

    // Fresh subscription
    this.subscriptions.set(sessionId, { onData, preview: opts?.preview });
    if (this._connected) {
      this.send({ type: 'terminal:subscribe', sessionId, preview: opts?.preview });
    }

    return () => this.unsubscribe(sessionId);
  }

  /** Unsubscribe from a session. Deferred to allow tier-switch re-subscribe. */
  unsubscribe(sessionId: string): void {
    const sub = this.subscriptions.get(sessionId);
    if (!sub) return;

    // Mark orphaned — data arriving during grace period is discarded
    sub.orphaned = true;

    // Defer actual server unsubscribe by 200ms to allow tier-switch re-subscribe
    const timer = setTimeout(() => {
      this.pendingUnsubs.delete(sessionId);
      const current = this.subscriptions.get(sessionId);
      if (current?.orphaned) {
        this.subscriptions.delete(sessionId);
        if (this._connected) {
          this.send({ type: 'terminal:unsubscribe', sessionId });
        }
      }
    }, 200);
    this.pendingUnsubs.set(sessionId, timer);
  }

  /** Send terminal input (keystrokes). */
  sendInput(sessionId: string, data: string): void {
    this.send({ type: 'terminal:input', sessionId, data });
  }

  /** Send terminal resize. */
  sendResize(sessionId: string, cols: number, rows: number): void {
    this.send({ type: 'terminal:resize', sessionId, cols, rows });
  }

  /** Register a global connection state handler. Returns cleanup fn. */
  onConnectionChange(handler: ConnectionHandler): () => void {
    this.connectionHandlers.add(handler);
    return () => this.connectionHandlers.delete(handler);
  }

  // ── Internal ──

  private openWs(): void {
    if (!this.token) return;
    this.clearReconnect();

    const gen = this.generation;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${location.host}/ws/terminals?token=${encodeURIComponent(this.token)}`;
    const ws = new WebSocket(url);
    this.pendingWs = ws;

    ws.onopen = () => {
      // If generation changed, this WS is stale (disconnect/reconnect happened)
      if (this.generation !== gen) {
        ws.close();
        return;
      }
      this.pendingWs = null;
      this.ws = ws;
      this.attempt = 0;
      this.setConnected(true);
      // Re-subscribe all active (non-orphaned) subscriptions
      for (const [sessionId, sub] of this.subscriptions) {
        if (!sub.orphaned) {
          this.send({ type: 'terminal:subscribe', sessionId, preview: sub.preview });
        }
      }
    };

    ws.onmessage = (event) => {
      if (this.generation !== gen) return;
      try {
        const msg: WsMessage = JSON.parse(event.data);
        if (msg.type === 'terminal:data' && msg.sessionId && msg.data) {
          const sub = this.subscriptions.get(msg.sessionId);
          if (sub && !sub.orphaned) sub.onData(msg.data);
        } else if (msg.type === 'terminal:error' && msg.sessionId) {
          console.warn(`[terminal-channel] error for ${msg.sessionId}: ${msg.error}`);
        }
      } catch {
        // Ignore unparseable messages
      }
    };

    ws.onclose = () => {
      if (this.generation !== gen) return; // stale WS, ignore
      this.ws = null;
      this.pendingWs = null;
      this.setConnected(false);
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose will fire after onerror
    };
  }

  /** Close both the active and any pending WS connection. */
  private closeAllWs(): void {
    if (this.ws) {
      this.ws.onclose = null; // prevent stale onclose from firing
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }
    if (this.pendingWs) {
      this.pendingWs.onclose = null;
      this.pendingWs.onmessage = null;
      this.pendingWs.close();
      this.pendingWs = null;
    }
  }

  private scheduleReconnect(): void {
    const delay = Math.min(1000 * 2 ** this.attempt, 30000);
    this.attempt++;
    this.reconnectTimer = setTimeout(() => this.openWs(), delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setConnected(value: boolean): void {
    if (this._connected === value) return;
    this._connected = value;
    for (const handler of this.connectionHandlers) {
      handler(value);
    }
  }

  private send(msg: WsMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }
}

/** Singleton instance */
export const terminalChannel = new TerminalChannel();
