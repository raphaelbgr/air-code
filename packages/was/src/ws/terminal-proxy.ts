import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import pino from 'pino';
import { AuthService } from '../services/auth.service.js';
import { SmsProxy } from '../services/sms-proxy.js';

const log = pino({ name: 'ws-terminal-proxy' });

/**
 * WebSocket proxy: Browser -> WAS (auth) -> SMS (terminal I/O).
 * Each browser client gets its own WAS-to-SMS connection.
 */
export function setupTerminalProxy(
  wss: WebSocketServer,
  authService: AuthService,
  smsProxy: SmsProxy,
): void {
  wss.on('connection', (clientWs: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    const sessionId = url.searchParams.get('sessionId');

    // Authenticate
    if (!token) {
      clientWs.close(4001, 'Missing token');
      return;
    }

    try {
      authService.verifyToken(token);
    } catch {
      clientWs.close(4001, 'Invalid token');
      return;
    }

    if (!sessionId) {
      clientWs.close(4002, 'Missing sessionId');
      return;
    }

    // Open upstream connection to SMS
    const smsWsUrl = smsProxy.getTerminalWsUrl(sessionId);
    const upstreamWs = new WebSocket(smsWsUrl);

    upstreamWs.on('open', () => {
      log.info({ sessionId }, 'upstream SMS connection opened');
    });

    // Relay: SMS -> Browser (send as text so browser gets string, not Blob)
    upstreamWs.on('message', (data) => {
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(data.toString());
      }
    });

    // Relay: Browser -> SMS
    clientWs.on('message', (data) => {
      if (upstreamWs.readyState === WebSocket.OPEN) {
        upstreamWs.send(data.toString());
      }
    });

    // Cleanup on either side close
    clientWs.on('close', () => {
      log.info({ sessionId }, 'client disconnected, closing upstream');
      upstreamWs.close();
    });

    upstreamWs.on('close', () => {
      log.info({ sessionId }, 'upstream disconnected, closing client');
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close(4000, 'SMS connection closed');
      }
    });

    upstreamWs.on('error', (err) => {
      log.error({ err, sessionId }, 'upstream ws error');
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.close(4003, 'SMS connection error');
      }
    });

    clientWs.on('error', (err) => {
      log.error({ err, sessionId }, 'client ws error');
      upstreamWs.close();
    });
  });
}
