import { v4 as uuid } from 'uuid';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pino from 'pino';
import type { User, AuthResponse } from '@claude-air/shared';
import { config } from '../config.js';
import { getDb } from '../db/database.js';
import type { JwtPayload } from '../types.js';

const log = pino({ name: 'auth' });

const AVATAR_COLORS = [
  '#ef4444', '#f97316', '#f59e0b', '#22c55e', '#06b6d4',
  '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#6366f1',
];

interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  avatar_color: string;
  created_at: string;
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatarColor: row.avatar_color,
    createdAt: row.created_at,
  };
}

export class AuthService {
  /**
   * Register a new user with an invite code.
   */
  async register(
    username: string,
    password: string,
    displayName: string,
    inviteCode: string,
  ): Promise<AuthResponse> {
    const db = getDb();

    // Validate invite code
    const invite = db.prepare('SELECT * FROM invites WHERE code = ? AND used = 0').get(inviteCode) as { code: string } | undefined;
    if (!invite) {
      throw new Error('Invalid or used invite code');
    }

    // Check username uniqueness
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) {
      throw new Error('Username already taken');
    }

    const id = uuid();
    const passwordHash = await bcrypt.hash(password, 10);
    const avatarColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

    db.prepare(`
      INSERT INTO users (id, username, password_hash, display_name, avatar_color)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, username, passwordHash, displayName, avatarColor);

    // Mark invite as used
    db.prepare('UPDATE invites SET used = 1, used_by = ? WHERE code = ?').run(id, inviteCode);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;
    const token = this.generateToken(user);

    log.info({ userId: id, username }, 'user registered');
    return { token, user: rowToUser(user) };
  }

  /**
   * Login with username and password.
   */
  async login(username: string, password: string): Promise<AuthResponse> {
    const db = getDb();
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined;
    if (!user) {
      throw new Error('Invalid credentials');
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      throw new Error('Invalid credentials');
    }

    const token = this.generateToken(user);
    log.info({ userId: user.id, username }, 'user logged in');
    return { token, user: rowToUser(user) };
  }

  /**
   * Verify a JWT token and return the payload.
   */
  verifyToken(token: string): JwtPayload {
    return jwt.verify(token, config.jwtSecret) as JwtPayload;
  }

  /**
   * Get user by ID.
   */
  getUser(id: string): User | null {
    const db = getDb();
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
    return row ? rowToUser(row) : null;
  }

  /**
   * Create a new invite code.
   */
  createInvite(createdBy: string): string {
    const db = getDb();
    const code = uuid().substring(0, 8).toUpperCase();
    db.prepare('INSERT INTO invites (code, created_by) VALUES (?, ?)').run(code, createdBy);
    log.info({ code, createdBy }, 'invite created');
    return code;
  }

  /**
   * Seed a default invite code if no invites exist (for first setup).
   */
  seedDefaultInvite(): void {
    const db = getDb();
    const count = db.prepare('SELECT COUNT(*) as c FROM invites').get() as { c: number };
    if (count.c === 0) {
      const code = 'WELCOME1';
      db.prepare('INSERT INTO invites (code) VALUES (?)').run(code);
      log.info({ code }, 'seeded default invite code');
    }
  }

  private generateToken(user: UserRow): string {
    const payload: JwtPayload = { userId: user.id, username: user.username };
    // Default 7 days in seconds
    const expiresIn = 7 * 24 * 60 * 60;
    return jwt.sign(payload, config.jwtSecret, { expiresIn });
  }
}
