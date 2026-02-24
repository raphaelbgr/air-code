# Claude Code Air — Project Rules

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

## Auth

- Default invite code: `WELCOME1`
- Passwords hashed with bcrypt (cost 10)
- JWT secret from `.env` (`WAS_JWT_SECRET`)
