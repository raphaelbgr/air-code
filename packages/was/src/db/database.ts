import Database from 'better-sqlite3';
import { mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import pino from 'pino';
import { config } from '../config.js';

const log = pino({ name: 'was-db' });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_color TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  created_by TEXT REFERENCES users(id),
  used INTEGER DEFAULT 0,
  used_by TEXT REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS canvas_state (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  state_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  path TEXT,
  created_by TEXT REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
`;

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = resolve(config.dbPath);
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(SCHEMA);

    // Migrations for existing databases
    try {
      db.exec('ALTER TABLE workspaces ADD COLUMN path TEXT');
    } catch {
      // Column already exists
    }

    try {
      db.exec("ALTER TABLE workspaces ADD COLUMN settings TEXT DEFAULT '{}'");
    } catch {
      // Column already exists
    }

    log.info({ path: dbPath }, 'WAS database initialized');
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    log.info('WAS database closed');
  }
}
