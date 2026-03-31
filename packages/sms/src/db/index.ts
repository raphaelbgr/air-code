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

    // Upgrade legacy DB schema (rename claude_session_id → cli_session_id, fix CHECK)
    upgradeLegacySchema(db);

    log.info({ path: dbPath }, 'database initialized');
  }
  return db;
}

/**
 * Upgrade legacy DB schema: rename claude_session_id → cli_session_id
 * and update CHECK constraint on type column from 'claude' to 'cli'.
 * Uses PRAGMA writable_schema to update CHECK in-place (no table drop).
 */
function upgradeLegacySchema(database: Database.Database): void {
  const result = database.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='sessions'"
  ).get() as { sql: string } | undefined;

  if (!result?.sql) return;

  const hasOldColumn = result.sql.includes('claude_session_id');
  // Only match the old CHECK constraint "'shell','claude'" — NOT "DEFAULT 'claude'"
  const hasOldCheck = result.sql.includes("'shell','claude'");

  if (!hasOldColumn && !hasOldCheck) return; // Already upgraded or fresh install

  try {
    if (hasOldColumn) {
      database.exec('ALTER TABLE sessions RENAME COLUMN claude_session_id TO cli_session_id');
    }

    if (hasOldCheck) {
      // Recreate table to update CHECK constraint (SQLite can't ALTER constraints)
      database.exec(`
        CREATE TABLE sessions_new (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          tmux_session TEXT NOT NULL UNIQUE,
          workspace_path TEXT NOT NULL,
          status TEXT DEFAULT 'running' CHECK(status IN ('running','idle','stopped','error')),
          type TEXT DEFAULT 'cli' CHECK(type IN ('shell','cli')),
          skip_permissions INTEGER DEFAULT 0,
          cli_session_id TEXT,
          created_at TEXT DEFAULT (datetime('now')),
          last_activity TEXT DEFAULT (datetime('now')),
          backend TEXT DEFAULT 'tmux',
          agent_hostname TEXT,
          cli_provider TEXT DEFAULT 'claude'
        );
        INSERT INTO sessions_new SELECT
          id, name, tmux_session, workspace_path, status,
          CASE WHEN type = 'claude' THEN 'cli' ELSE type END,
          skip_permissions, cli_session_id, created_at, last_activity,
          backend, agent_hostname,
          'claude'
        FROM sessions;
        DROP TABLE sessions;
        ALTER TABLE sessions_new RENAME TO sessions;
      `);
    }

    log.info('upgraded legacy schema references');
  } catch (err) {
    log.warn({ err }, 'legacy schema upgrade skipped');
  }
}

export function closeDb(): void {
  if (db) {
    // Checkpoint WAL to base DB before closing to ensure data persistence
    try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
    db.close();
    log.info('database closed');
  }
}
