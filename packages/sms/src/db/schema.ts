export const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tmux_session TEXT NOT NULL UNIQUE,
  workspace_path TEXT NOT NULL,
  status TEXT DEFAULT 'running' CHECK(status IN ('running','idle','stopped','error')),
  type TEXT DEFAULT 'claude' CHECK(type IN ('shell','claude')),
  skip_permissions INTEGER DEFAULT 0,
  claude_session_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  last_activity TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transcripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  timestamp TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transcripts_session ON transcripts(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
`;

/** Additive migration: add type column to existing sessions table. */
export const MIGRATIONS = [
  `ALTER TABLE sessions ADD COLUMN type TEXT DEFAULT 'claude' CHECK(type IN ('shell','claude'))`,
];
