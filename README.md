# Air Code

**A web-based canvas for managing multiple AI coding agent terminal sessions.** Organize sessions into workspaces, view live terminal output, fork conversations, and collaborate with multi-user presence — all in your browser.

![Air Code Screenshot](docs/screenshot.png)

![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)
![Node.js](https://img.shields.io/badge/Node.js-22+-339933?logo=nodedotjs)
![License](https://img.shields.io/badge/License-MIT-green)

## Why Air Code?

Modern AI coding agents (Claude Code, Codex, etc.) run as CLI sessions. When working on complex projects, you often need **multiple parallel sessions** — one researching, one coding, one testing. Managing these in separate terminal windows quickly becomes chaotic.

Air Code solves this by giving you a **visual canvas** where every session is a card you can see, organize, fork, and monitor in real-time:

```
┌──────────────────────────────────────────────────────────────┐
│  Air Code Canvas                                              │
│                                                                │
│  ┌─── Workspace: my-app ────────────────────────────────┐     │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐           │     │
│  │  │ Session 1 │  │ Session 2 │  │ Session 3 │           │     │
│  │  │ (coding)  │  │ (testing) │  │  (fork)   │           │     │
│  │  │ █████████ │  │ █████████ │  │ █████████ │           │     │
│  │  │ █████████ │  │ █████████ │  │ █████████ │           │     │
│  │  └──────────┘  └──────────┘  └──────────┘           │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                                │
│  ┌─── Workspace: docs ──────┐                                 │
│  │  ┌──────────┐            │                                 │
│  │  │ Session 4 │            │                                 │
│  │  │ (writing) │            │                                 │
│  │  └──────────┘            │                                 │
│  └──────────────────────────┘                                 │
└──────────────────────────────────────────────────────────────┘
```

## Features

- **🖥️ Canvas-based session management** — Drag, resize, and organize session cards within workspace bubbles
- **📡 Real-time terminal streaming** — Live xterm.js terminals with WebSocket multiplexing
- **🔀 Session forking** — Branch AI conversations mid-flow with full context preservation
- **📂 Workspace detection** — Auto-detect projects from `~/.claude/projects/`
- **👥 Multi-user presence** — See who's viewing which session in real-time
- **🤖 AI agent** — Natural language session management via Anthropic API
- **💾 Canvas persistence** — Layout auto-saves; pick up right where you left off
- **🐳 Dual backends** — tmux (persistent, via WSL) or native PTY (bash/PowerShell)
- **🔌 Remote terminals** — Stream a terminal from any machine into the canvas

## Architecture

Air Code is a TypeScript monorepo with 4 packages:

```
Browser (:5173)  →  WAS (:7333)  →  SMS (:7331)  →  tmux / PTY
   React + xterm      API hub          Sessions        Claude Code
```

| Package | Role | Tech |
|---------|------|------|
| **`@air-code/web`** | Frontend — canvas, terminals, state | React 19, ReactFlow, xterm.js, Zustand, Vite |
| **`@air-code/was`** | API hub — auth, workspaces, proxy | Express, SQLite (WAL), JWT, WebSocket |
| **`@air-code/sms`** | Session lifecycle — PTY/tmux I/O | node-pty, tmux IPC, SQLite |
| **`@air-code/shared`** | Types, constants, utilities | Pure TypeScript |

> **10,800+ lines of TypeScript** across the monorepo.

## Quick Start

### Prerequisites

- **Node.js** >= 22
- **pnpm** >= 9 (`npm install -g pnpm`)
- **tmux** (Linux/macOS) or **WSL with tmux** (Windows)

### Installation

```bash
git clone https://github.com/raphaelbgr/air-code.git
cd air-code
cp .env.example .env
pnpm install
pnpm --filter @air-code/shared build
```

### Running

```bash
# Start all servers (SMS + WAS + Web)
pnpm dev

# Or start individually:
pnpm dev:sms   # Session Manager  → :7331
pnpm dev:was   # API Server       → :7333
pnpm dev:web   # Vite Frontend    → :5173
```

Open **http://localhost:5173** and register with invite code: `WELCOME1`

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all services concurrently |
| `pnpm dev:sms` | Session Manager Server only |
| `pnpm dev:was` | Web Application Server only |
| `pnpm dev:web` | Vite dev server only |
| `pnpm build` | Build all packages |
| `pnpm typecheck` | TypeScript check all packages |
| `pnpm test` | Run all tests |
| `pnpm kill-all` | Kill all dev servers |

## Environment Variables

Copy `.env.example` to `.env`:

```bash
# Session Manager Server
SMS_PORT=7331

# Web Application Server
WAS_PORT=7333
WAS_JWT_SECRET=your-secret-here

# AI Agent (optional — enables natural language session control)
ANTHROPIC_API_KEY=sk-ant-xxx
```

See individual [package docs](#documentation) for the full variable list.

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/architecture.md) | System overview, data flows, startup sequence |
| [SMS](docs/sms.md) | Session Manager — PTY/tmux, WebSocket, database |
| [WAS](docs/was.md) | Web Application Server — API, auth, workspaces |
| [Web](docs/web.md) | Frontend — React, canvas, terminal, state management |
| [Shared](docs/shared.md) | Types, constants, utilities |
| [Workspace Detection](docs/workspace-detection.md) | How workspaces are discovered |

## Platform Support

| Platform | Backend | Notes |
|----------|---------|-------|
| **Linux / macOS** | tmux (native) | Recommended — persistent sessions survive restarts |
| **Windows** | tmux via WSL | Path conversion (`C:\` ↔ `/mnt/c/`) handled automatically |
| **Any** | Native PTY | Spawns bash/PowerShell directly, no tmux required |

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE) — Copyright (c) 2025-2026 Raphael Bernardo
