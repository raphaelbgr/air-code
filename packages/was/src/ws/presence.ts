import type { Server as SocketIOServer } from 'socket.io';
import pino from 'pino';
import {
  PRESENCE_JOIN,
  PRESENCE_LEAVE,
  PRESENCE_UPDATE,
  PRESENCE_USERS,
} from '@claude-air/shared';
import { AuthService } from '../services/auth.service.js';
import { PresenceService } from '../services/presence.service.js';

const log = pino({ name: 'presence-ws' });

export function setupPresence(
  io: SocketIOServer,
  authService: AuthService,
  presenceService: PresenceService,
): void {
  // Auth middleware for Socket.IO
  io.use((socket, next) => {
    const token = socket.handshake.auth.token as string;
    if (!token) {
      return next(new Error('Missing token'));
    }
    try {
      const payload = authService.verifyToken(token);
      socket.data.user = payload;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const { userId, username } = socket.data.user;
    const user = authService.getUser(userId);
    if (!user) {
      socket.disconnect();
      return;
    }

    presenceService.join(socket.id, {
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarColor: user.avatarColor,
    });

    // Broadcast updated user list
    io.emit(PRESENCE_USERS, presenceService.getAll());
    log.info({ userId, username }, 'socket connected');

    // Handle viewing session update
    socket.on(PRESENCE_UPDATE, (data: { sessionId?: string }) => {
      presenceService.updateViewing(socket.id, data.sessionId);
      io.emit(PRESENCE_USERS, presenceService.getAll());
    });

    socket.on('disconnect', () => {
      presenceService.leave(socket.id);
      io.emit(PRESENCE_USERS, presenceService.getAll());
      log.info({ userId, username }, 'socket disconnected');
    });
  });
}
