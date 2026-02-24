import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Server as SocketIOServer } from 'socket.io';
import pino from 'pino';
import { config } from './config.js';

// Catch-all error handlers to prevent silent hangs
process.on('uncaughtException', (err) => {
  console.error('[WAS] Uncaught exception:', err);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  console.error('[WAS] Unhandled rejection:', err);
  process.exit(1);
});
import { getDb, closeDb } from './db/database.js';
import { AuthService } from './services/auth.service.js';
import { SmsProxy } from './services/sms-proxy.js';
import { CanvasService } from './services/canvas.service.js';
import { PresenceService } from './services/presence.service.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { errorHandler } from './middleware/error-handler.js';
import { createAuthRoutes } from './routes/auth.js';
import { createSessionRoutes } from './routes/sessions.js';
import { createCanvasRoutes } from './routes/canvas.js';
import { createWorkspaceRoutes } from './routes/workspaces.js';
import { createHealthRoutes } from './routes/health.js';
import { createAgentRoutes } from './routes/agent.js';
import { AgentService } from './services/agent.service.js';
import { setupTerminalProxy } from './ws/terminal-proxy.js';
import { setupPresence } from './ws/presence.js';

const log = pino({
  name: 'was',
  level: config.logLevel,
  transport: config.nodeEnv === 'development' ? { target: 'pino-pretty' } : undefined,
});

// Initialize
const app = express();
const server = createServer(app);

// Services
const authService = new AuthService();
const smsProxy = new SmsProxy();
const canvasService = new CanvasService();
const presenceService = new PresenceService();
const agentService = new AgentService(smsProxy);

// Initialize DB and seed
getDb();
authService.seedDefaultInvite();

// Middleware
app.use(cors());
app.use(express.json({ limit: '5mb' })); // canvas state can be large

const requireAuth = createAuthMiddleware(authService);

// Public routes
app.use('/api/auth', createAuthRoutes(authService));
app.use('/api/health', createHealthRoutes(smsProxy));

// Protected routes
app.use('/api/sessions', requireAuth, createSessionRoutes(smsProxy));
app.use('/api/canvas', requireAuth, createCanvasRoutes(canvasService));
app.use('/api/workspaces', requireAuth, createWorkspaceRoutes(smsProxy));
app.use('/api/agent', requireAuth, createAgentRoutes(agentService));

// Serve static frontend in production
const __dirname = dirname(fileURLToPath(import.meta.url));
const webDist = resolve(__dirname, '../../web/dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  // SPA fallback: serve index.html for non-API routes
  app.get('*', (_req, res, next) => {
    if (_req.path.startsWith('/api') || _req.path.startsWith('/ws') || _req.path.startsWith('/socket.io')) {
      return next();
    }
    res.sendFile(resolve(webDist, 'index.html'));
  });
  log.info({ webDist }, 'serving static frontend');
}

// Error handler
app.use(errorHandler);

// WebSocket: terminal proxy (raw WS, noServer to avoid conflicting with Socket.IO)
const terminalWss = new WebSocketServer({ noServer: true });
setupTerminalProxy(terminalWss, authService, smsProxy);

// Socket.IO: presence (with JWT in handshake.auth)
const io = new SocketIOServer(server, {
  cors: { origin: '*' },
  path: '/socket.io',
});
setupPresence(io, authService, presenceService);

// Route WebSocket upgrades: terminal goes to ws, everything else to Socket.IO
server.on('upgrade', (req, socket, head) => {
  const pathname = req.url?.split('?')[0];
  if (pathname === '/ws/terminal') {
    terminalWss.handleUpgrade(req, socket, head, (ws) => {
      terminalWss.emit('connection', ws, req);
    });
  }
  // Socket.IO handles its own upgrades via the server attachment above
});

// Start server
server.listen(config.port, config.host, () => {
  log.info({
    port: config.port,
    host: config.host,
    smsUrl: config.smsUrl,
  }, `WAS server started on http://${config.host}:${config.port}`);
});

// Graceful shutdown
function shutdown() {
  log.info('shutting down...');
  io.close();
  closeDb();
  server.close();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
