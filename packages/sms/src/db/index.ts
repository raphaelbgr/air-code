import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import pino from 'pino';
import { config } from '../config.js';
import { SCHEMA, MIGRATIONS } from './schema.js';

const log = pino({ name: 'db' });

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = resolve(config.dbPath);
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // NEVER delete WAL/SHM files — they contain uncommitted transactions.
    // SQLite handles WAL recovery automatically when opening the database.
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.exec(SCHEMA);

    // Run additive migrations (safe to re-run)
    for (const sql of MIGRATIONS) {
      try { db.exec(sql); } catch { /* column already exists */ }
    }

    log.info({ path: dbPath }, 'database initialized');
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    // Checkpoint WAL to base DB before closing to ensure data persistence
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
    db.close();
    log.info('database closed');
  }
}
