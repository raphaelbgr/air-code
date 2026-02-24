# SMS — Session Manager Server

**Package:** `@claude-air/sms` | **Port:** 7331 | **Entry:** `src/index.ts`

## Overview

SMS manages Claude Code terminal sessions running via **tmux** (through WSL on Windows) or **native PTY** (PowerShell/bash). It spawns, controls, and streams terminal output from Claude Code sessions over WebSocket.

## Core Responsibilities

- Spawn and manage Claude Code sessions in tmux or native PTY
- Stream real-time terminal output to WebSocket clients via multiplexed broadcasting
- Handle keyboard input and terminal resize events
- Track session metadata in SQLite (status, workspace, Claude session IDs)
- Auto-detect Claude session IDs by watching `~/.claude/projects/`
- Reconcile orphan tmux sessions on startup
- Lazy-load PTY processes only when clients connect

## Configuration

Environment variables (loaded from `.env`):

| Variable | Default | Description |
|----------|---------|-------------|
| `SMS_PORT` | 7331 | Server port |
| `SMS_HOST` | 0.0.0.0 | Bind address |
| `SMS_DB_PATH` | ./data/sessions.db | SQLite database file |
| `SMS_MAX_SCROLLBACK` | 10000 | Lines of terminal output kept in memory |
| `LOG_LEVEL` | info | Pino log level |

## Services Architecture

### SessionService (`src/services/session.service.ts`)

Main orchestrator for session lifecycle.

| Method | Purpose |
|--------|---------|
| `create(req)` | Spawn new Claude Code or shell session (tmux or PTY) |
| `list()` | Get all sessions, checking live status |
| `get(id)` | Get single session metadata |
| `kill(id)` | Terminate session, cleanup db/watchers |
| `sendKeys(id, keys)` | Send keyboard input to session |
| `captureOutput(id, lines)` | Capture scrollback buffer (REST fallback) |
| `reattach(id)` | Reconnect to session after network disconnect |
| `reattachAll()` | Lazy-load preparation (called on startup) |
| `ensureAttached(id)` | Trigger actual PTY spawning on first client |
| `cleanupOrphans()` | Reconcile tmux/DB state on startup |

### TmuxControlMode (`src/services/tmux-control.service.ts`)

Spawns `tmux attach-session` inside a real PTY (node-pty). Raw ANSI escape codes stream directly to the browser.

- On Windows: spawn `wsl tmux attach-session -t <name>`
- On Linux: spawn `tmux attach-session -t <name>`
- Emit `output` events → multiplexer broadcasts to all clients
- `detach()` kills the PTY process but tmux session stays alive

### PtyDirectMode (`src/services/pty-direct.service.ts`)

Spawns native shell (PowerShell on Windows, bash on Linux) without tmux.

- No tmux session — direct PTY process
- No scrollback capture available via REST
- `detach()` kills the PTY AND the session (unlike tmux)
- Better for single-pane scenarios, faster spawning

### MockTmuxControlMode (`src/services/mock-tmux.service.ts`)

Simulates terminal output when tmux isn't available (Windows dev without WSL). All session operations work but output is fake.

### MultiplexerRegistry & SessionMultiplexer (`src/services/multiplexer.service.ts`)

Manages one-to-many WebSocket connections for a single session.

- `addClient(clientId, ws)` — Add WebSocket client, send scrollback history
- `broadcast(data)` — Send output to ALL connected clients, store in scrollback
- `getLeader()` — Which client determines resize size
- CircularBuffer stores last N lines for replay on reconnect
- Preview clients yield resize control to full panel clients

### TranscriptService (`src/services/transcript.service.ts`)

Stores transcript/chat entries in SQLite for future session replay.

### watchForClaudeSession

Claude Code writes `.jsonl` files to `~/.claude/projects/<folder>/`. SMS watches this directory with `fs.watch` to detect new sessions:

1. Encode workspace path to folder name (Windows: `C:\Users\foo` → `C--Users-foo`)
2. Snapshot existing `.jsonl` files in the folder
3. Open `fs.watch` (event-driven, not polling)
4. When new `.jsonl` appears, extract session ID from filename
5. Update database with `claude_session_id`
6. Close watcher after detection (or after 60s timeout)

## REST API

Base path: `/api/sessions`

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/` | GET | List all sessions |
| `/:id` | GET | Get single session |
| `/` | POST | Create new session |
| `/:id` | DELETE | Kill session |
| `/:id` | PUT | Rename session |
| `/:id/reattach` | POST | Reconnect to session |
| `/:id/send` | POST | Send keyboard input (`{ keys }`) |
| `/:id/output` | GET | Capture scrollback (`?lines=100`) |

### Create Session Request

```json
{
  "name": "my-workspace",
  "workspacePath": "C:\\Users\\rbgnr\\git\\my-project",
  "type": "claude",
  "backend": "tmux",
  "skipPermissions": false,
  "claudeResumeId": "optional-session-to-resume",
  "forkSession": false
}
```

## WebSocket API

**Path:** `/ws/terminal?sessionId=<id>&preview=true|false`

### Client → Server Messages

```json
{ "type": "terminal:input", "data": "npm run dev\r" }
{ "type": "terminal:resize", "cols": 200, "rows": 50 }
```

### Server → Client Messages

```json
{ "type": "terminal:data", "sessionId": "...", "data": "$ npm run dev\n..." }
{ "type": "terminal:resized", "sessionId": "...", "cols": 200, "rows": 50 }
```

- TCP_NODELAY enabled for low-latency keystrokes
- Preview clients yield resize control to full panels
- Lazy PTY attachment: PTY spawned only when first client connects

## Database Schema

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  tmux_session TEXT UNIQUE,
  workspace_path TEXT NOT NULL,
  status TEXT CHECK (status IN ('running','idle','stopped','error')),
  type TEXT CHECK (type IN ('shell','claude')),
  skip_permissions INTEGER DEFAULT 0,
  claude_session_id TEXT,
  backend TEXT CHECK (backend IN ('tmux','pty')),
  created_at TEXT,
  last_activity TEXT
);

CREATE TABLE transcripts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  timestamp TEXT DEFAULT (datetime('now'))
);
```

## Health Endpoint

```
GET /api/health → { status: "ok"|"degraded", version, uptime, mock }
```

## Startup & Reconciliation

1. `getDb()` — Create database, enable WAL + foreign keys, run migrations
2. `cleanupOrphans()` — Mark PTY sessions as stopped, reconcile tmux state
3. `reattachAll()` — Prepare sessions for lazy PTY loading (no spawn yet)
4. `ensureAttached()` — Called by first WebSocket client → spawns actual PTY

## Windows/WSL Specifics

- Platform detection: `IS_WINDOWS = process.platform === 'win32'`
- Tmux commands route through WSL: `wsl bash -c "tmux ..."`
- Path conversion: `C:\Users\foo` ↔ `/mnt/c/Users/foo`
- Project folder symlinks bridge Windows/WSL path encodings
- HOME set explicitly when launching Claude Code in tmux

## Dependencies

| Package | Purpose |
|---------|---------|
| express | HTTP framework |
| ws | WebSocket server |
| node-pty | Spawn native PTY processes |
| better-sqlite3 | Synchronous SQLite |
| pino | Structured logging |
| zod | Input validation |
| uuid | Generate session IDs |
