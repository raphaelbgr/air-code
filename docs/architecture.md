# Architecture & Data Flow (v0.1.0)

## System Overview

Air Code is a monorepo with 4 packages that together provide a web-based canvas for managing Claude Code terminal sessions.

> Version is defined in `packages/shared/src/constants.ts` (`VERSION`) and exposed via `/api/health`.

```
┌──────────────────────────────────────────────────────────────┐
│                    Browser (React + xterm.js)                 │
│                   localhost:5173 (Vite dev)                   │
└──────────────┬────────────────────┬──────────────────────────┘
               │                    │
          REST /api            WS /ws, /socket.io
          (Vite proxy)         (Vite proxy)
               │                    │
               ▼                    ▼
┌──────────────────────────────────────────────────────────────┐
│              WAS — Web Application Server (:7333)             │
│  Auth (JWT) · Workspaces · Canvas · Presence · Agent · Proxy │
└──────────────┬────────────────────┬──────────────────────────┘
               │                    │
          REST /api            WS /ws/terminal
               │                    │
               ▼                    ▼
┌──────────────────────────────────────────────────────────────┐
│            SMS — Session Manager Server (:7331)               │
│  Sessions · PTY/tmux · Multiplexer · Scrollback · DB         │
└──────────────┬────────────────────┬──────────────────────────┘
               │                    │
          tmux backend         PTY backend
               │                    │
               ▼                    ▼
┌─────────────────────┐  ┌────────────────────┐
│ WSL tmux sessions   │  │ PowerShell / bash   │
│ (persistent)        │  │ (ephemeral)         │
└─────────────────────┘  └────────────────────┘
               │                    │
               └────────┬───────────┘
                        ▼
              Claude Code CLI running
                in terminal session
```

## Three-Server Architecture

| Server | Port | Role |
|--------|------|------|
| **Vite** | 5173 | Dev server, proxies API/WS to WAS |
| **WAS** | 7333 | API hub, auth, workspaces, canvas, presence, proxy to SMS |
| **SMS** | 7331 | Session lifecycle, PTY/tmux management, terminal I/O |

All browser traffic routes through WAS (for auth), then WAS proxies to SMS for terminal operations.

## Session Lifecycle

### Creation

```
Browser → POST /api/sessions → WAS → SMS
  ├─ Allocate UUID session ID
  ├─ Choose backend (tmux or pty)
  │
  ├─ tmux backend:
  │   ├─ wsl tmux new-session -s cca-<id> -c <workspace>
  │   ├─ tmux send-keys "claude [--resume] [--fork-session]"
  │   ├─ Insert DB (status='running', backend='tmux')
  │   ├─ Attach TmuxControlMode (node-pty → tmux attach-session)
  │   └─ watchForClaudeSession() → detect .jsonl file
  │
  └─ PTY backend:
      ├─ Insert DB (status='running', backend='pty')
      ├─ Spawn PtyDirectMode (powershell.exe or bash)
      ├─ Type "claude [--resume] [--fork-session]"
      └─ watchForClaudeSession() → detect .jsonl file
```

### Running (Terminal I/O)

```
Browser keystroke → WS /ws/terminals → WAS → SMS upstream
  → sessionService.sendKeys() → ctrl.sendKeys() → PTY.write()

PTY output → ctrl.emit('output') → multiplexer.broadcast()
  → All SMS WebSocket clients → WAS relay → Browser xterm.js
```

### Fork (`--fork-session`)

```
Browser → POST /api/sessions (claudeResumeId + forkSession: true)
  → SMS creates NEW session ID
  → Starts claude --resume <original-id> --fork-session
  → Claude Code creates new .jsonl file (new branch)
  → watchForClaudeSession() detects it
  → Original session continues undisturbed
```

### Kill/Termination

```
Browser → DELETE /api/sessions/:id → WAS → SMS
  ├─ tmux: kill-session first, then detach PTY
  ├─ PTY: kill process directly
  ├─ Close fs.watch if active
  ├─ Remove from multiplexer
  └─ DELETE FROM sessions
```

### Reopen (after restart)

```
Browser → POST /api/sessions/:id/reopen → WAS → SMS
  ├─ Verify session exists and status = 'stopped'
  ├─ Generate new tmux/pty name
  │
  ├─ tmux backend:
  │   ├─ wsl tmux new-session -s cca-<new-id> -c <workspace>
  │   ├─ claude --resume <claudeSessionId> [--dangerously-skip-permissions]
  │   └─ Attach TmuxControlMode
  │
  └─ PTY backend:
      ├─ Spawn PtyDirectMode
      └─ Type claude --resume <claudeSessionId>
  │
  ├─ UPDATE sessions SET tmux_session=<new>, status='running'
  ├─ watchForClaudeSession() if Claude type
  └─ Return same session ID (canvas position preserved)
```

## WebSocket Strategies

### Per-Client Proxy (`/ws/terminal`)

```
Browser #1 WS → WAS → SMS  (1:1 mapping)
Browser #2 WS → WAS → SMS  (separate upstream)
```

Simple but creates more upstream connections.

### Multiplexed Channel (`/ws/terminals`) — Recommended

```
Browser WS (1 per client)
  ├─ subscribe(session-A)    ─┐
  ├─ subscribe(session-B)     ├─ Shared SMS upstreams
  └─ unsubscribe(session-A)  ─┘   (one per unique session)
```

Messages contain `sessionId` for routing. First browser opens SMS upstream, last closes it.

**Message types:** `terminal:subscribe`, `terminal:unsubscribe`, `terminal:input`, `terminal:resize`, `terminal:data`, `terminal:error`

## Claude Session Detection

When Claude Code starts, it creates a `.jsonl` file in `~/.claude/projects/<encoded-folder>/`.

```
1. Encode workspace path → folder name
   Windows: C:\Users\foo\bar → C--Users-foo-bar
   WSL:     /mnt/c/Users/foo/bar → -mnt-c-Users-foo-bar

2. fs.watch(~/.claude/projects/<folder>/)

3. New .jsonl detected → extract filename as session UUID

4. UPDATE sessions SET claude_session_id = ? WHERE id = ?

5. Close watcher (or timeout after 60s)
```

Event-driven (not polling) to avoid race conditions.

## PTY vs tmux Backends

| Feature | tmux | PTY Direct |
|---------|------|------------|
| Spawn method | `wsl tmux new-session` | `powershell.exe` or `bash` |
| Persistence | Survives client disconnect | Dies with server |
| Scrollback capture | `tmux capture-pane` | Not available |
| Platform | Requires WSL on Windows | Native on all platforms |
| Overhead | WSL layer | Direct process |
| Session name | `cca-<id>` | `pty-<id>` |

## Database Architecture

**SMS database** (`packages/sms/data/sessions.db`):
- `sessions` — Session metadata (id, name, tmux_session, workspace_path, status, type, claude_session_id, backend)
- `transcripts` — Session transcript entries (for future replay)

**WAS database** (`packages/was/data/was.db`):
- `users` — Auth (username, password_hash, display_name, avatar_color)
- `invites` — Invite codes (code, used, used_by)
- `canvas_state` — Per-user canvas layout (state_json)
- `workspaces` — Workspace metadata (name, path, color, settings)

Both use SQLite with WAL mode and foreign keys enabled. Migrations are additive only (ALTER TABLE ADD COLUMN).

## Windows/WSL Bridge

```
Windows (Node.js)              WSL (tmux, Claude Code)
├─ SMS runs here               ├─ /usr/bin/tmux (3.4)
├─ WAS runs here               ├─ claude CLI
├─ Vite runs here              └─ /mnt/c/... filesystem
└─ Calls: wsl.exe
```

Path conversion: `C:\Users\foo` ↔ `/mnt/c/Users/foo`

Project folder symlinks bridge Windows/WSL naming:
- Windows creates: `C--Users-foo-bar/`
- WSL creates: `-mnt-c-Users-foo-bar/`
- SMS creates symlink so both resolve to the same folder

## Instance Registration & Kill Script

Servers register in `.dev-instances.json` on startup:

```json
{
  "sms": { "pid": 12345, "port": 7331, "name": "sms", "startedAt": "..." },
  "was": { "pid": 12346, "port": 7333, "name": "was", "startedAt": "..." }
}
```

`scripts/kill-all.py` reads this file and kills by PID tree (`taskkill /F /T`). Falls back to port scanning via PowerShell if instance file is missing.

## Startup Sequence

```
pnpm dev
  ├─ concurrently SMS + WAS
  │
  ├─ SMS (:7331)
  │   ├─ getDb() → create tables, enable WAL
  │   ├─ checkTmux() → validate availability
  │   ├─ cleanupOrphans() → mark dead sessions as stopped, adopt orphan tmux
  │   ├─ reattachAll() → prepare lazy loading
  │   ├─ Listen on :7331
  │   └─ registerInstance('sms', 7331)
  │
  ├─ WAS (:7333)
  │   ├─ getDb() → create tables, enable WAL
  │   ├─ seedDefaultInvite() → "WELCOME1"
  │   ├─ Setup routes + WebSocket handlers
  │   ├─ Listen on :7333
  │   └─ registerInstance('was', 7333)
  │
  └─ Vite (:5173) — via pnpm dev:web
      └─ Proxy /api, /ws, /socket.io → :7333
```

## Shutdown

```
Ctrl+C (or pnpm kill-all)
  ├─ WAS: deregisterInstance → close Socket.IO → close DB → close server
  └─ SMS: deregisterInstance → close DB → close server
```

## Multiplexer & Leader Election

```
Multiple clients viewing same session:
  Client A (full panel) ← leader (controls resize)
  Client B (preview)    ← yields to leader
  Client C (preview)    ← yields to leader

When leader disconnects:
  Client B promoted to leader

Preview clients skip scrollback replay to avoid
rendering old ANSI codes at wrong terminal size.
```

## Package Dependency Graph

```
@claude-air/shared (types, constants, dates)
  ├── @claude-air/sms (imports types + constants + instance)
  ├── @claude-air/was (imports types + constants)
  └── @claude-air/web (imports types + constants + dates)
```

`@claude-air/shared/instance` is imported only by SMS and WAS (Node.js), never by web (browser).
