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
  created_by TEXT REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
