# Web — Frontend Application

**Package:** `@claude-air/web` | **Port:** 5173 (dev) | **Entry:** `src/main.tsx`

## Overview

React frontend for managing interactive terminal sessions and Claude Code workspaces. Provides a canvas-based session visualization with real-time terminal streaming, multi-user presence, session forking, and workspace management.

**Stack:** React 19 + TypeScript + Zustand + ReactFlow + xterm.js + Vite + Tailwind CSS v4

## Key Components

### Canvas (`src/components/canvas/`)

#### CanvasView.tsx
Main ReactFlow wrapper. Manages node/edge state, layout initialization, viewport. Polls sessions/workspaces every 5 seconds. Handles Cmd+K search. Auto-saves canvas layout every 15s.

#### SessionNode.tsx
Individual session card (ReactFlow node):
- **Header:** Session name, status dot (green/orange/gray/red), action buttons
- **Terminal preview:** Live xterm output or "Session stopped" message
- **Footer:** Workspace folder name, viewer avatars
- **Actions:** Reconnect, Fork (Claude sessions), Kill, Copy tmux attach command, Join locally
- **Presence:** Colored borders show which users are viewing the session

#### WorkspaceBubble.tsx
Workspace container (ReactFlow parent node):
- **Header:** Folder icon, workspace name, settings, session count badge
- **Dropdowns:** Two sectioned dropdowns for Terminal (Shell/WSL) and Claude (PowerShell/WSL)
- **Footer:** Workspace path + description
- Dynamic sizing: grows/shrinks to fit child sessions (3 per row grid)

#### CanvasToolbar.tsx
Top-left action buttons: Workspace, Detect, Session, Search (Cmd+K), Agent.

#### SaveStatusIcon.tsx
Cloud icon showing canvas layout save status (idle → saving → saved → idle).

#### SearchDialog.tsx
Cmd+K search for sessions/workspaces with keyboard navigation.

### Terminal (`src/components/terminal/`)

#### TerminalView.tsx
Core xterm.js terminal:
- **Active mode** (selected): Input enabled, cursor blink, sends resize
- **Passive mode:** Read-only stream, no input
- Font: JetBrains Mono, fitted to 80 cols, 8-14pt range
- Ctrl+C copies selection, Ctrl+V pastes
- Uses `terminalChannel.subscribe()` with `preview: true`

#### terminal-config.ts
Dark theme (#0a0a0f background), indigo cursor (#818cf8).

### Auth (`src/components/auth/`)
- **LoginPage.tsx** — Username/password login
- **RegisterPage.tsx** — Registration with invite code

### Dialogs (`src/components/dialogs/`)
- **CreateSessionDialog** — Manual session creation
- **CreateWorkspaceDialog** — Create or import workspaces
- **DetectWorkspacesDialog** — Auto-scan directory, import git repos
- **WorkspaceSettingsDialog** — Edit workspace settings, Claude args
- **ClaudeLauncherDialog** — Launch Claude Code with resume/fork options

### Layout (`src/components/`)
- **AppLayout.tsx** — Top-level layout, initializes WebSocket/Socket.IO/canvas sync
- **TopBar** — User display, logout, save status icon
- Mobile variants: MobileListView, MobileTerminal, MobileFAB

## State Management (Zustand)

### canvas.store.ts
```typescript
{
  nodes: Node<AppNodeData>[];      // ReactFlow nodes
  edges: Edge[];
  viewport: Viewport;              // x, y, zoom
  activeSessionId: string | null;  // Currently selected session
  saveStatus: 'idle'|'saving'|'saved'|'error';

  initCanvasFromData(workspaces, sessions, savedLayout?)
  mergeCanvasWithData(workspaces, sessions)  // 5s poll merges
}
```

### session.store.ts
```typescript
{
  sessions: Session[];
  workspaces: Workspace[];
  fetchAll(): Promise<void>;       // Parallel fetch both
  addSession / removeSession / updateSession
  addWorkspace / removeWorkspace
}
```

### auth.store.ts
JWT token + user, persisted to localStorage via Zustand `persist` middleware.

### presence.store.ts
Live users viewing sessions. Updated via Socket.IO `PRESENCE_USERS` event.

### terminal.store.ts
Terminal metadata (cols, rows, connected state) per session.

### agent.store.ts
Right-panel agent chat messages and panel open/close state.

## API Client (`src/lib/api.ts`)

RESTful client to WAS backend:

```typescript
api.auth.login(username, password)
api.auth.register(username, password, displayName, inviteCode)

api.sessions.list()
api.sessions.create({ name, workspacePath, type?, backend?, skipPermissions?, claudeArgs?, claudeResumeId?, forkSession? })
api.sessions.kill(id)
api.sessions.sendKeys(id, keys)
api.sessions.reattach(id)
api.sessions.captureOutput(id, lines?)

api.workspaces.list()
api.workspaces.create({ name, description?, color? })
api.workspaces.detect(scanDir?)
api.workspaces.import(workspaces[])
api.workspaces.updateSettings(id, settings)
api.workspaces.claudeSessions(id)

api.canvas.get()
api.canvas.save(state)
```

Base URL: `/api` (Vite proxies to `:7333`). Auth via JWT in Authorization header.

## Terminal Channel (`src/lib/terminal-channel.ts`)

Singleton multiplexed WebSocket for all terminal streaming:

- One WS connection, many subscriptions (by sessionId)
- Subscribe/unsubscribe with 200ms deferred cleanup
- Auto-reconnect with exponential backoff (1s → 30s max)
- Generation tracking to invalidate stale connections

## Presence (`src/hooks/usePresence.ts`)

Socket.IO connection for multi-user awareness:
- Broadcast which session user is viewing
- Colored borders on SessionNodes when others are viewing
- Avatar stacks (up to 3) in footer of each session node

## Canvas Sync (`src/hooks/useCanvasSync.ts`)

Auto-saves layout every 15 seconds:
- Strips node data, saves only layout metadata (positions, edges, viewport)
- JSON comparison to avoid unnecessary saves
- Status tracking: idle → saving → saved → idle

## Vite Configuration

```typescript
{
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': './src' } },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:7333',
      '/ws': { target: 'ws://localhost:7333', ws: true },
      '/socket.io': { target: 'http://localhost:7333', ws: true }
    }
  }
}
```

## Design System (`src/styles/globals.css`)

Dark theme with CSS custom properties:
- Background: `#0a0a0f` (primary), `#141420` (secondary), `#1e1e2e` (tertiary)
- Text: `#e4e4e7` (primary), `#a1a1aa` (secondary), `#71717a` (muted)
- Accent: `#818cf8` (indigo)
- Status colors: green (running), amber (idle), red (error/stopped)

## Dependencies

| Package | Purpose |
|---------|---------|
| react / react-dom | UI framework (v19) |
| zustand | State management |
| @xyflow/react | Canvas (nodes/edges) |
| @xterm/xterm | Terminal emulator |
| @xterm/addon-fit | Auto-fit terminal to container |
| socket.io-client | Presence events |
| framer-motion | Animations |
| lucide-react | Icons |
| tailwindcss | Styling (v4) |
| react-hot-toast | Toast notifications |
| react-markdown | Markdown rendering (agent panel) |

## Scripts

```bash
pnpm dev           # Vite dev server :5173
pnpm build         # tsc + vite build → dist/
pnpm preview       # Preview production build
pnpm typecheck     # tsc --noEmit
```
