import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import { v4 as uuid } from 'uuid';
import pino from 'pino';
import type { WsMessage } from '@claude-air/shared';
import { SessionService } from '../services/session.service.js';
import { MultiplexerRegistry } from '../services/multiplexer.service.js';

const log = pino({ name: 'ws-terminal' });

export function setupTerminalWebSocket(
  wss: WebSocketServer,
  sessionService: SessionService,
  multiplexers: MultiplexerRegistry,
): void {
  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // Extract session ID from URL: /ws/terminal?sessionId=xxx or /ws/terminal/:id
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('sessionId')
      || url.pathname.split('/').filter(Boolean).pop()
      || '';

    if (!sessionId) {
      ws.close(4002, 'Missing session ID');
      return;
    }

    const session = sessionService.get(sessionId);
    if (!session) {
      ws.close(4003, 'Session not found');
      return;
    }

    const isPreview = url.searchParams.get('preview') === 'true';
    const clientId = uuid();
    const mux = multiplexers.getOrCreate(sessionId);
    mux.addClient(clientId, ws, isPreview);

    log.info({ sessionId, clientId }, 'terminal client connected');

    ws.on('message', async (raw) => {
      try {
        const msg: WsMessage = JSON.parse(raw.toString());

        switch (msg.type) {
          case 'terminal:input':
            if (msg.data) {
              await sessionService.sendKeys(sessionId, msg.data);
            }
            break;

          case 'terminal:resize':
            if (msg.cols && msg.rows) {
              const ctrl = sessionService.getController(sessionId);
              if (ctrl?.attached) {
                // Any client can resize — the last resize wins.
                // The full panel's resize will override the mini terminal's.
                await ctrl.resizePane(session.tmuxSession, msg.cols, msg.rows);
              }
            }
            break;

          default:
            log.warn({ type: msg.type }, 'unknown ws message type');
        }
      } catch (err) {
        log.error({ err }, 'error handling ws message');
      }
    });

    ws.on('close', () => {
      mux.removeClient(clientId);
      log.info({ sessionId, clientId }, 'terminal client disconnected');
    });

    ws.on('error', (err) => {
      log.error({ err, sessionId, clientId }, 'ws error');
      mux.removeClient(clientId);
    });
  });
}
