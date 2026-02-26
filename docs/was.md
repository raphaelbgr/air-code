# WAS — Web Application Server

**Package:** `@claude-air/was` | **Port:** 7333 | **Entry:** `src/index.ts`

## Overview

WAS is the central API hub for Air Code. It handles authentication, serves the React frontend, proxies session management to SMS, manages workspaces, persists canvas layout, tracks user presence, and provides an AI agent interface.

## Core Responsibilities

- User authentication (JWT tokens, invite codes, bcrypt password hashing)
- Serve React frontend in production mode
- Proxy session management requests to SMS (port 7331)
- Manage workspaces (project directories with metadata and settings)
- Canvas state persistence (visual workspace layout)
- Real-time presence tracking (Socket.IO)
- Multiplex terminal I/O (WebSocket channels)
- AI agent tasks (Claude API integration)

## Configuration

Environment variables (loaded from `.env`):

| Variable | Default | Description |
|----------|---------|-------------|
| `WAS_PORT` | 7333 | Server port |
| `WAS_HOST` | 0.0.0.0 | Bind address |
| `WAS_SMS_URL` | http://localhost:7331 | SMS endpoint |
| `WAS_JWT_SECRET` | dev-secret-change-me | JWT signing key |
| `WAS_JWT_EXPIRY` | 7d | Token expiration |
| `WAS_DB_PATH` | ./data/was.db | SQLite database |
| `ANTHROPIC_API_KEY` | (empty) | Claude API key for agent |
| `AI_AGENT_MODEL` | claude-sonnet-4-20250514 | Agent model |
| `AI_AGENT_MAX_TOKENS` | 4096 | Max tokens per response |

## Routes & Endpoints

### Authentication (`/api/auth`) — Public

#### `POST /api/auth/register`
```json
{
  "username": "raphaelbgr",
  "password": "password123",
  "displayName": "Raphael",
  "inviteCode": "WELCOME1"
}
```
Returns `{ token, user }`. Username 3-30 chars, password 6+.

#### `POST /api/auth/login`
```json
{ "username": "raphaelbgr", "password": "password123" }
```
Returns `{ token, user }`.

### Sessions (`/api/sessions`) — Protected

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/` | GET | List all sessions (proxied from SMS) |
| `/:id` | GET | Get session details |
| `/` | POST | Create session |
| `/:id` | DELETE | Kill session |
| `/:id/reattach` | POST | Reconnect to session |
| `/:id/reopen` | POST | Reopen stopped session with fresh process |
| `/:id/send` | POST | Send keystrokes |
| `/:id/output` | GET | Capture terminal output |
| `/:id/paste-image` | POST | Upload pasted image |

### Workspaces (`/api/workspaces`) — Protected

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/browse` | POST | Browse server filesystem (`{ path? }`) |
| `/detect` | GET | Auto-detect workspaces from `~/.claude/projects/` |
| `/import` | POST | Bulk import detected workspaces |
| `/` | GET | List all workspaces with session stats |
| `/` | POST | Create workspace |
| `/:id` | PUT | Update workspace metadata |
| `/:id/settings` | PATCH | Update workspace settings |
| `/:id/claude-sessions` | GET | List Claude Code conversations |
| `/:id` | DELETE | Delete workspace (cascade-kills sessions) |

### Canvas (`/api/canvas`) — Protected

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/` | GET | Get user's canvas layout |
| `/` | PUT | Save canvas layout (nodes, edges, viewport) |

### Agent (`/api/agent`) — Protected

#### `POST /api/agent/chat`
```json
{ "message": "Create a new session for Stream-Lens", "conversationId": "optional" }
```

Available agent tools: `list_sessions`, `get_session_status`, `create_session`, `send_to_session`, `read_session_output`, `kill_session`.

### Health (`/api/health`) — Public

Returns `{ status: "ok"|"degraded", version, uptime, os?, hostname? }`. Status is "degraded" if SMS is unreachable. Forwards `os` and `hostname` from SMS health response.

## Database Schema

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_color TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE invites (
  code TEXT PRIMARY KEY,
  created_by TEXT REFERENCES users(id),
  used INTEGER DEFAULT 0,
  used_by TEXT REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE canvas_state (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  state_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  path TEXT,
  settings TEXT DEFAULT '{}',
  created_by TEXT REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
```

## WebSocket Architecture

### Terminal Proxy (`/ws/terminal?token=...&sessionId=...`)

Direct 1:1 relay from browser to SMS for a single session.

### Terminal Channel (`/ws/terminals?token=...`)

Multiplexed terminal I/O — one browser WebSocket subscribes to multiple sessions.

Messages: `terminal:subscribe`, `terminal:unsubscribe`, `terminal:input`, `terminal:resize`, `terminal:data`, `terminal:error`

Upstreams are pooled — one SMS connection per unique session, shared across browser clients.

### Presence (`/socket.io`)

Socket.IO for real-time user awareness. Events: `PRESENCE_JOIN`, `PRESENCE_LEAVE`, `PRESENCE_UPDATE`, `PRESENCE_USERS`.

## Key Services

### AuthService
- `register()` / `login()` — JWT tokens (HS256, 7-day expiry)
- `seedDefaultInvite()` — Creates "WELCOME1" on first startup
- Passwords hashed with bcrypt (cost 10)

### SmsProxy
- HTTP client proxying all session requests to SMS
- `reopenSession(id, body?)` — proxy to SMS reopen endpoint
- `browsePath(path?)` — proxy to SMS browse endpoint
- `uploadImage(sessionId, buffer, contentType)` — proxy paste image
- `getTerminalWsUrl(sessionId)` for WebSocket upgrade

### CanvasService
- `get(userId)` / `save(userId, state)` — Canvas layout persistence

### PresenceService
- In-memory tracking of connected Socket.IO users
- Broadcasts full user list on join/leave/update

### AgentService
- Claude SDK integration for autonomous session management
- Multi-turn tool-use loop (up to 10 turns)

## Workspace Detection

Scans `~/.claude/projects/` for Claude Code session data:
- Reads `.jsonl` files directly (sessions-index.json deprecated)
- Extracts session ID, summary, message count, git branch
- 30-second cache TTL to avoid excessive filesystem reads
- Can also recursively scan a directory for `.git`, `package.json`, etc.

## Dependencies

| Package | Purpose |
|---------|---------|
| @anthropic-ai/sdk | Claude API for agent |
| bcryptjs | Password hashing |
| better-sqlite3 | SQLite database |
| express | HTTP server |
| jsonwebtoken | JWT auth |
| socket.io | Presence tracking |
| ws | WebSocket server |
| zod | Schema validation |
