import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import pino from 'pino';
import { config } from './config.js';
import { getDb, closeDb } from './db/index.js';
import { SessionService } from './services/session.service.js';
import { MultiplexerRegistry } from './services/multiplexer.service.js';
import { TranscriptService } from './services/transcript.service.js';
import { createSessionRoutes } from './routes/sessions.js';
import { createHealthRoutes } from './routes/health.js';
import { createBrowseRoutes } from './routes/browse.js';
import { setupTerminalWebSocket } from './ws/terminal.handler.js';
import { setupRemoteTerminalWebSocket } from './ws/remote-terminal.handler.js';
import { registerInstance, deregisterInstance } from '@air-code/shared/instance';

// Catch-all error handlers to prevent silent hangs
process.on('uncaughtException', (err) => {
  console.error('[SMS] Uncaught exception:', err);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  console.error('[SMS] Unhandled rejection:', err);
  process.exit(1);
});

const log = pino({
  name: 'sms',
  level: config.logLevel,
  transport: config.nodeEnv === 'development' ? { target: 'pino-pretty' } : undefined,
});

// Initialize
const app = express();
const server = createServer(app);

// Middleware
app.use(cors());
app.use(express.json());

// Services
const multiplexers = new MultiplexerRegistry();
const sessionService = new SessionService(multiplexers);
const _transcriptService = new TranscriptService();

// Initialize DB
getDb();

// Async init for session service (tmux detection)
await sessionService.init();

// REST routes
app.use('/api/sessions', createSessionRoutes(sessionService));
app.use('/api/health', createHealthRoutes(sessionService));
app.use('/api/browse', createBrowseRoutes());

// WebSocket servers (noServer: ws docs require this when routing multiple WSS on one HTTP server)
const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
setupTerminalWebSocket(wss, sessionService, multiplexers);

const remoteWss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
setupRemoteTerminalWebSocket(remoteWss, sessionService, multiplexers);

// Route WebSocket upgrades by path
server.on('upgrade', (req, socket, head) => {
  const pathname = req.url?.split('?')[0];
  if (pathname === '/ws/terminal') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else if (pathname === '/ws/remote-terminal') {
    remoteWss.handleUpgrade(req, socket, head, (ws) => {
      remoteWss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

// Clean up orphan tmux sessions not tracked in DB, mark dead DB sessions as stopped
await sessionService.cleanupOrphans();

// Reattach to existing tmux sessions
await sessionService.reattachAll();

// Start server
server.listen(config.port, config.host, async () => {
  const tmuxAvailable = await sessionService.checkTmux();
  const cliProviders = await sessionService.checkCliProviders();
  log.info({
    port: config.port,
    host: config.host,
    tmux: tmuxAvailable ? 'available' : 'NOT FOUND',
    mock: sessionService.isMockMode,
    cliProviders,
  }, `SMS server started on http://${config.host}:${config.port}`);

  registerInstance('sms', config.port, import.meta.url);

  if (!tmuxAvailable) {
    log.warn('tmux is not installed or not in PATH. Running in MOCK mode.');
  }
});

// Graceful shutdown
function shutdown() {
  log.info('shutting down...');
  deregisterInstance('sms', import.meta.url);
  closeDb();
  server.close();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
