import type { PresenceUser } from '@claude-air/shared';
import pino from 'pino';

const log = pino({ name: 'presence' });

/**
 * In-memory presence tracking for connected users.
 */
export class PresenceService {
  private users: Map<string, PresenceUser> = new Map(); // socketId -> user

  join(socketId: string, user: PresenceUser): void {
    this.users.set(socketId, user);
    log.info({ socketId, userId: user.userId }, 'user joined presence');
  }

  leave(socketId: string): PresenceUser | undefined {
    const user = this.users.get(socketId);
    this.users.delete(socketId);
    if (user) {
      log.info({ socketId, userId: user.userId }, 'user left presence');
    }
    return user;
  }

  updateViewing(socketId: string, sessionId: string | undefined): void {
    const user = this.users.get(socketId);
    if (user) {
      user.viewingSessionId = sessionId;
    }
  }

  getAll(): PresenceUser[] {
    return Array.from(this.users.values());
  }

  getViewingSession(sessionId: string): PresenceUser[] {
    return this.getAll().filter((u) => u.viewingSessionId === sessionId);
  }
}
