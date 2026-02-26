# Shared — Types, Constants & Utilities

**Package:** `@claude-air/shared` | **Entry:** `src/index.ts`

## Overview

Shared library consumed by all packages. Contains TypeScript types, constants, date utilities, and a Node.js-only instance registration module.

## Exports Structure

Dual export paths to separate browser-safe code from Node.js-only code:

```json
{
  ".": "./dist/index.js",
  "./instance": "./dist/instance.js"
}
```

- `import { ... } from '@claude-air/shared'` — Types, constants, dates (browser-safe)
- `import { ... } from '@claude-air/shared/instance'` — Instance registration (Node.js only)

The barrel `index.ts` intentionally does NOT export `instance.ts` to prevent Vite from bundling `node:fs` and `node:path` into the browser build.

## Types (`src/types.ts`)

### Session Types

```typescript
type SessionStatus = 'running' | 'idle' | 'stopped' | 'error'
type SessionType = 'shell' | 'claude'
type SessionBackend = 'tmux' | 'pty'

interface Session {
  id: string
  name: string
  tmuxSession: string
  workspacePath: string
  status: SessionStatus
  type: SessionType
  skipPermissions: boolean
  claudeSessionId?: string
  backend?: SessionBackend
  createdAt: string
  lastActivity: string
}

interface CreateSessionRequest {
  name: string
  workspacePath: string
  type?: SessionType
  skipPermissions?: boolean
  claudeArgs?: string
  claudeResumeId?: string
  forkSession?: boolean
  backend?: SessionBackend
}

interface ClaudeSession {
  sessionId: string
  summary: string
  messageCount: number
  lastActive: string
  diskSize?: number
  gitBranch?: string
}
```

### Workspace Types

```typescript
interface WorkspaceSettings {
  skipPermissions?: boolean
  claudeArgs?: string
}

interface Workspace {
  id: string
  name: string
  description?: string
  color: string
  path?: string
  settings?: WorkspaceSettings
  createdBy?: string
  createdAt: string
  claudeSessionCount?: number
  claudeLastActive?: string
}

interface DetectedWorkspace {
  path: string
  name: string
  sessionCount: number
  lastActive: string
  alreadyImported: boolean
}
```

### Auth Types

```typescript
interface User {
  id: string
  username: string
  displayName: string
  avatarColor: string
  createdAt: string
}

interface LoginRequest { username: string; password: string }
interface RegisterRequest { username: string; password: string; displayName: string; inviteCode: string }
interface AuthResponse { token: string; user: User }
```

### Canvas & Presence Types

```typescript
interface CanvasState {
  nodes: unknown[]
  edges: unknown[]
  viewport: { x: number; y: number; zoom: number }
}

interface PresenceUser {
  userId: string
  username: string
  displayName: string
  avatarColor: string
  viewingSessionId?: string
}
```

### WebSocket Message Types

```typescript
type WsMessageType =
  | 'terminal:data' | 'terminal:resize' | 'terminal:resized'
  | 'terminal:input' | 'terminal:subscribe' | 'terminal:unsubscribe'
  | 'terminal:error'

interface WsMessage {
  type: WsMessageType
  sessionId: string
  data?: string
  cols?: number
  rows?: number
  preview?: boolean
  error?: string
  code?: number
}
```

### Agent Types

```typescript
interface AgentMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: AgentToolCall[]
  timestamp: string
}

interface AgentToolCall {
  id: string
  name: string
  input: Record<string, unknown>
  result?: string
}

interface ApiResponse<T> { ok: boolean; data?: T; error?: string }
interface HealthResponse { status: 'ok' | 'degraded' | 'error'; version: string; uptime: number; os?: string; hostname?: string }
```

### Browse Types

```typescript
interface BrowseItem {
  name: string
  isDir: boolean
  description?: string
}

interface BrowseResult {
  path: string
  parent: string | null
  items: BrowseItem[]
}
```

## Constants (`src/constants.ts`)

```typescript
export const SMS_DEFAULT_PORT = 7331
export const WAS_DEFAULT_PORT = 7333
export const DEFAULT_SCROLLBACK = 10_000
export const VERSION = '0.1.0'

// WebSocket Close Codes
export const WS_CLOSE_NORMAL = 1000
export const WS_CLOSE_GOING_AWAY = 1001
export const WS_CLOSE_SESSION_KILLED = 4000
export const WS_CLOSE_AUTH_FAILED = 4001

// Socket.IO Presence Events
export const PRESENCE_JOIN = 'presence:join'
export const PRESENCE_LEAVE = 'presence:leave'
export const PRESENCE_UPDATE = 'presence:update'
export const PRESENCE_USERS = 'presence:users'

// tmux
export const TMUX_SESSION_PREFIX = 'cca-'
```

## Date Utilities (`src/dates.ts`)

Convention: Server stores UTC via SQLite `datetime('now')` → API transmits ISO 8601 → Clients parse to local timezone.

| Function | Purpose |
|----------|---------|
| `serverNow()` | Current UTC time as ISO 8601 string |
| `parseServerDate(str)` | Parse ISO 8601 or SQLite format into Date |
| `formatRelative(str)` | Relative string: "just now", "2m ago", "3h ago" |
| `formatDateTime(str)` | Locale-aware: "Jan 24, 2025, 12:30 PM" |
| `formatDate(str)` | Locale-aware date only: "Jan 24, 2025" |

## Instance Registration (`src/instance.ts`)

Node.js-only module for dev server process tracking.

```typescript
interface InstanceEntry {
  pid: number
  port: number
  name: string
  startedAt: string
}

registerInstance(name: string, port: number, callerUrl: string): void
deregisterInstance(name: string, callerUrl: string): void
```

Writes to `.dev-instances.json` at the project root. Used by `scripts/kill-all.py` to reliably kill dev servers.

## Project Configuration

### Root package.json

```bash
pnpm dev          # Start SMS + WAS concurrently
pnpm dev:sms      # Start just SMS on :7331
pnpm dev:was      # Start just WAS on :7333
pnpm dev:web      # Start Vite dev server on :5173
pnpm kill-all     # Kill all servers (Python script)
pnpm build        # Build all packages
pnpm typecheck    # TypeScript check all packages
```

Monorepo: pnpm workspaces (`packages/*`). Node.js >= 22 required.

### Root tsconfig.base.json

Target ES2022, module Node16, strict mode, declaration + sourceMap.

### Environment Variables (.env)

See individual package docs for full variable lists. Key variables:
- `SMS_PORT`, `WAS_PORT` — Server ports
- `WAS_JWT_SECRET` — JWT signing key (change in production!)
- `ANTHROPIC_API_KEY` — For AI agent features
