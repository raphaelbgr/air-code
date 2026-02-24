import Database from 'better-sqlite3';
import { mkdirSync, existsSync, unlinkSync } from 'node:fs';
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

    // Clean up stale WAL lock files from crashed processes
    const walPath = dbPath + '-wal';
    const shmPath = dbPath + '-shm';
    try {
      if (existsSync(shmPath)) unlinkSync(shmPath);
      if (existsSync(walPath)) unlinkSync(walPath);
    } catch {
      // Files may be locked by another running instance - that's OK
    }

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
    db.close();
    log.info('database closed');
  }
}
