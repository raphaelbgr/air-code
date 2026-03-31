import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import pino from 'pino';
import type { WsMessage } from '@air-code/shared';
import { SessionService } from '../services/session.service.js';
import { MultiplexerRegistry } from '../services/multiplexer.service.js';

const log = pino({ name: 'ws-remote-terminal' });

/**
 * WebSocket handler for incoming remote terminal agents.
 * Agent connects, sends remote:register, gets a session created, and I/O is proxied.
 */
export function setupRemoteTerminalWebSocket(
  wss: WebSocketServer,
  sessionService: SessionService,
  multiplexers: MultiplexerRegistry,
): void {
  wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
    // Disable Nagle's algorithm
    const socket = (ws as any)._socket;
    if (socket?.setNoDelay) socket.setNoDelay(true);

    let registered = false;

    // Wait for the agent to send remote:register as first message
    const onMessage = (raw: Buffer | string) => {
      try {
        const msg: WsMessage = JSON.parse(raw.toString());

        if (!registered && msg.type === 'remote:register') {
          const hostname = msg.hostname || 'unknown';
          const shell = msg.shell || 'unknown';

          // Create session record
          const session = sessionService.createRemote({ hostname, shell });

          // Attach agent WebSocket to session (creates RemoteAgentMode)
          sessionService.attachRemoteAgent(session.id, ws);

          // Ack with session ID
          ws.send(JSON.stringify({
            type: 'remote:registered',
            sessionId: session.id,
          }));

          registered = true;
          log.info({ sessionId: session.id, hostname, shell }, 'remote agent registered');

          // Remove this listener — RemoteAgentMode now handles messages
          ws.removeListener('message', onMessage);
          return;
        }

        if (!registered) {
          log.warn({ type: msg.type }, 'expected remote:register as first message');
          ws.close(4010, 'Expected remote:register');
        }
      } catch (err) {
        log.error({ err }, 'error handling remote agent message');
        ws.close(4011, 'Invalid message');
      }
    };

    ws.on('message', onMessage);

    // Timeout if agent doesn't register within 10s
    const timeout = setTimeout(() => {
      if (!registered) {
        log.warn('remote agent did not register in time');
        ws.close(4012, 'Registration timeout');
      }
    }, 10000);

    ws.on('close', () => {
      clearTimeout(timeout);
    });
  });
}
