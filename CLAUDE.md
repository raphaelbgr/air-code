# Air Code — Project Rules (v0.1.0)

## Version

- Current version: `0.1.0` — defined in `packages/shared/src/constants.ts` (`VERSION`)
- This is the single source of truth; all servers and the frontend read from it

## Database Safety

- **NEVER delete, wipe, reset, or recreate the database unless the user explicitly requests it.**
- **NEVER delete WAL/SHM files** — these contain uncommitted transactions. Deleting them causes data loss.
- Do not run `unlinkSync` or `rm` on `.db`, `.db-wal`, or `.db-shm` files.
- Migrations must be additive only (ALTER TABLE ADD COLUMN with try/catch). Never DROP tables.
- DB path: `packages/was/data/was.db`

## Servers

- Start all: `pnpm dev` (runs SMS :7331, WAS :7333, Vite :5173)
- Start individual: `pnpm dev:sms`, `pnpm dev:was`, `pnpm dev:web`
- After code changes, WAS must be restarted (kill + `pnpm dev:was`) since tsx watch may not pick up new files

## Platform

- Runs on Windows — tmux is accessed via WSL (`wsl tmux ...`)
- All tmux spawn/exec calls must route through `wsl` on Windows (`IS_WINDOWS` flag in SMS services)
- WSL has tmux 3.4 at `/usr/bin/tmux`

## Remote Terminal

Share a terminal from any machine into the Air Code web UI:

```bash
npx tsx scripts/remote-agent.ts              # connects to localhost:7331
npx tsx scripts/remote-agent.ts 192.168.1.x # connects to HOST:7331
npx tsx scripts/remote-agent.ts HOST:PORT     # custom port
```

- Agent connects directly to SMS (no auth, no WAS proxy)
- Spawns a **new** shell — does NOT share the terminal you run the command from
- Shows up in the canvas with an orange "REMOTE" badge and hostname tooltip
- Auto-reconnects with exponential backoff if SMS restarts
- Join/Fork buttons are hidden for remote sessions (PTY lives on the agent's machine)
- Backend type: `'remote'` (vs `'tmux'` or `'pty'` for local sessions)
- Key files: `scripts/remote-agent.ts`, `packages/sms/src/services/remote-agent.service.ts`, `packages/sms/src/ws/remote-terminal.handler.ts`

## Canvas Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Scroll` | Smooth pan |
| `Ctrl+Scroll` | Smooth zoom (cursor-centered, rAF lerp) |
| `Drag` | Move nodes |
| `Tab` | Cycle to next terminal/workspace (left-to-right) |
| `Shift+Tab` | Cycle backwards |
| `Ctrl+K` | Toggle search dialog |
| `Esc` | Close search / deselect active session |

**Tab cycling order:** Workspaces sorted by X position (leftmost first, Y tiebreaker for equal X). Workspaces with sessions are replaced by their sessions in the focus list (sorted by visual grid position: leftmost then topmost). Empty workspaces appear as their own tab stop. Orphan sessions appended at end.

## Auth

- Default invite code: `WELCOME1`
- Passwords hashed with bcrypt (cost 10)
- JWT secret from `.env` (`WAS_JWT_SECRET`)
