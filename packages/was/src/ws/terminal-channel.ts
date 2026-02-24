import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import pino from 'pino';
import type { WsMessage } from '@claude-air/shared';
import { AuthService } from '../services/auth.service.js';
import { SmsProxy } from '../services/sms-proxy.js';

const log = pino({ name: 'ws-terminal-channel' });

interface Upstream {
  ws: WebSocket;
  subscriberCount: number;
}

interface ChannelInfo {
  userId: string;
  subscriptions: Set<string>;
}

export interface ChannelStats {
  channels: number;
  upstreams: number;
  upstreamDetails: Array<{ sessionId: string; subscribers: number; wsState: number }>;
  channelDetails: Array<{ userId: string; subscriptions: string[] }>;
  msgIn: number;
  msgOut: number;
}

/**
 * Multiplexed terminal channel: many sessions over one browser WebSocket.
 * Upstream SMS connections are shared across browser clients viewing the same session.
 */
export function setupTerminalChannel(
  wss: WebSocketServer,
  authService: AuthService,
  smsProxy: SmsProxy,
): { getStats: () => ChannelStats } {
  // Shared upstream SMS connections (sessionId → upstream)
  const upstreams = new Map<string, Upstream>();
  // Per-browser-client tracking
  const channels = new Map<WebSocket, ChannelInfo>();
  // Diagnostic counters
  let msgIn = 0;
  let msgOut = 0;

  wss.on('connection', (clientWs: WebSocket, req: IncomingMessage) => {
    // Disable Nagle's algorithm — flush keystrokes immediately
    const socket = (clientWs as any)._socket;
    if (socket?.setNoDelay) socket.setNoDelay(true);

    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token) {
      clientWs.close(4001, 'Missing token');
      return;
    }

    let userId: string;
    try {
      const payload = authService.verifyToken(token);
      userId = payload.userId;
    } catch {
      clientWs.close(4001, 'Invalid token');
      return;
    }

    const channel: ChannelInfo = { userId, subscriptions: new Set() };
    channels.set(clientWs, channel);
    log.info({ userId }, 'terminal channel connected');

    clientWs.on('message', (raw) => {
      msgIn++;
      let msg: WsMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      const { type, sessionId } = msg;
      if (!sessionId) return;

      switch (type) {
        case 'terminal:subscribe':
          handleSubscribe(clientWs, channel, sessionId);
          break;
        case 'terminal:unsubscribe':
          handleUnsubscribe(clientWs, channel, sessionId);
          break;
        case 'terminal:input':
        case 'terminal:resize':
          forwardToUpstream(sessionId, msg);
          break;
      }
    });

    clientWs.on('close', () => {
      log.info({ userId }, 'terminal channel disconnected');
      // Unsubscribe from all sessions
      for (const sessionId of channel.subscriptions) {
        decrementUpstream(sessionId);
      }
      channels.delete(clientWs);
    });

    clientWs.on('error', (err) => {
      log.error({ err, userId }, 'terminal channel error');
    });
  });

  function handleSubscribe(
    _clientWs: WebSocket,
    channel: ChannelInfo,
    sessionId: string,
  ): void {
    if (channel.subscriptions.has(sessionId)) return; // already subscribed
    channel.subscriptions.add(sessionId);

    const existing = upstreams.get(sessionId);
    if (existing) {
      existing.subscriberCount++;
      log.debug({ sessionId, subscribers: existing.subscriberCount }, 'upstream reused');
      return;
    }

    openUpstream(sessionId);
  }

  function openUpstream(sessionId: string): void {
    const smsWsUrl = smsProxy.getTerminalWsUrl(sessionId);
    const upstreamWs = new WebSocket(smsWsUrl);
    const upstream: Upstream = { ws: upstreamWs, subscriberCount: 1 };
    upstreams.set(sessionId, upstream);

    upstreamWs.on('open', () => {
      // Disable Nagle's algorithm on upstream connection too
      const socket = (upstreamWs as any)._socket;
      if (socket?.setNoDelay) socket.setNoDelay(true);
      log.info({ sessionId }, 'upstream SMS opened');
    });

    // Fan-out: SMS data → all subscribed browser clients
    upstreamWs.on('message', (data) => {
      // Guard: if this upstream was replaced (race condition), ignore its data
      if (upstreams.get(sessionId) !== upstream) return;

      const text = data.toString();
      for (const [ws, ch] of channels) {
        if (ch.subscriptions.has(sessionId) && ws.readyState === WebSocket.OPEN) {
          ws.send(text);
          msgOut++;
        }
      }
    });

    upstreamWs.on('close', () => {
      // CRITICAL: Only clean up if this upstream is still the current one.
      // A new upstream may have been created (rapid unsubscribe/resubscribe
      // from React StrictMode or canvas scrolling). If so, this is a stale
      // close event and we must NOT touch the new upstream or subscriptions.
      if (upstreams.get(sessionId) !== upstream) {
        log.debug({ sessionId }, 'stale upstream close ignored');
        return;
      }

      log.info({ sessionId }, 'upstream SMS closed');
      // Notify all subscribers and clean up
      const errorMsg: WsMessage = {
        type: 'terminal:error',
        sessionId,
        error: 'SMS connection closed',
        code: 4000,
      };
      const errorText = JSON.stringify(errorMsg);
      for (const [ws, ch] of channels) {
        if (ch.subscriptions.has(sessionId) && ws.readyState === WebSocket.OPEN) {
          ws.send(errorText);
        }
        ch.subscriptions.delete(sessionId);
      }
      upstreams.delete(sessionId);
    });

    upstreamWs.on('error', (err) => {
      log.error({ err, sessionId }, 'upstream SMS error');
    });
  }

  function handleUnsubscribe(
    _clientWs: WebSocket,
    channel: ChannelInfo,
    sessionId: string,
  ): void {
    if (!channel.subscriptions.has(sessionId)) return;
    channel.subscriptions.delete(sessionId);
    decrementUpstream(sessionId);
  }

  function decrementUpstream(sessionId: string): void {
    const upstream = upstreams.get(sessionId);
    if (!upstream) return;
    upstream.subscriberCount--;
    if (upstream.subscriberCount <= 0) {
      log.debug({ sessionId }, 'no subscribers left, closing upstream');
      // Remove from map BEFORE closing so the onclose handler sees itself as stale
      // if a new upstream is created before the close handshake completes.
      upstreams.delete(sessionId);
      upstream.ws.close();
    }
  }

  function forwardToUpstream(sessionId: string, msg: WsMessage): void {
    const upstream = upstreams.get(sessionId);
    if (upstream && upstream.ws.readyState === WebSocket.OPEN) {
      upstream.ws.send(JSON.stringify(msg));
    }
  }

  function getStats(): ChannelStats {
    const upstreamDetails: ChannelStats['upstreamDetails'] = [];
    for (const [sessionId, u] of upstreams) {
      upstreamDetails.push({ sessionId, subscribers: u.subscriberCount, wsState: u.ws.readyState });
    }
    const channelDetails: ChannelStats['channelDetails'] = [];
    for (const [, ch] of channels) {
      channelDetails.push({ userId: ch.userId, subscriptions: [...ch.subscriptions] });
    }
    return { channels: channels.size, upstreams: upstreams.size, upstreamDetails, channelDetails, msgIn, msgOut };
  }

  return { getStats };
}
