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
    // Disable Nagle's algorithm — flush keystrokes immediately
    const socket = (ws as any)._socket;
    if (socket?.setNoDelay) socket.setNoDelay(true);

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

    // Lazy PTY attachment: spawn the PTY only when the first client connects.
    // This avoids spawning 30+ PTY processes simultaneously on server startup.
    sessionService.ensureAttached(sessionId);

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
              const isPreview = mux.isPreviewClient(clientId);
              const hasFullPanel = mux.hasFullPanelClient();

              // Preview clients yield resize control when a full panel is connected.
              // This prevents the mini terminal from shrinking tmux when the user
              // has the full panel open — the full panel's size always wins.
              if (isPreview && hasFullPanel) {
                // Still ack so the client can start rendering (at the full panel's size)
                ws.send(JSON.stringify({
                  type: 'terminal:resized',
                  sessionId,
                  cols: msg.cols,
                  rows: msg.rows,
                }));
                break;
              }

              const ctrl = sessionService.getController(sessionId);
              if (ctrl?.attached) {
                await ctrl.resizePane(session.tmuxSession, msg.cols, msg.rows);
              }

              // Ack the resize so the client knows it's safe to start rendering.
              // Data after this point is at the new terminal size.
              ws.send(JSON.stringify({
                type: 'terminal:resized',
                sessionId,
                cols: msg.cols,
                rows: msg.rows,
              }));
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
