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
import { setupTerminalWebSocket } from './ws/terminal.handler.js';
import { registerInstance, deregisterInstance } from '@claude-air/shared/instance';

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

// REST routes
app.use('/api/sessions', createSessionRoutes(sessionService));
app.use('/api/health', createHealthRoutes(sessionService));

// WebSocket for terminal I/O
const wss = new WebSocketServer({ server, path: '/ws/terminal' });
setupTerminalWebSocket(wss, sessionService, multiplexers);

// Clean up orphan tmux sessions not tracked in DB, mark dead DB sessions as stopped
sessionService.cleanupOrphans();

// Reattach to existing tmux sessions
sessionService.reattachAll();

// Start server
server.listen(config.port, config.host, () => {
  const tmuxAvailable = sessionService.checkTmux();
  log.info({
    port: config.port,
    host: config.host,
    tmux: tmuxAvailable ? 'available' : 'NOT FOUND',
    mock: sessionService.isMockMode,
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
