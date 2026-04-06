# Contributing to Air Code

Thank you for your interest in contributing to Air Code! This guide will help you get started.

## Getting Started

1. **Fork the repository** and clone your fork
2. **Install dependencies:** `pnpm install`
3. **Copy environment config:** `cp .env.example .env`
4. **Build shared package:** `pnpm --filter @air-code/shared build`
5. **Start development servers:** `pnpm dev`

## Development Workflow

### Project Structure

```
packages/
├── shared/    # Types, constants, utilities (build first)
├── sms/       # Session Manager Server (PTY/tmux lifecycle)
├── was/       # Web Application Server (API, auth, WebSocket proxy)
└── web/       # React frontend (canvas, terminals, state)
```

### Running Tests

```bash
pnpm test          # Run all tests
pnpm test:watch    # Watch mode
pnpm typecheck     # TypeScript type checking
```

### Code Style

- TypeScript strict mode is enabled across all packages
- Use `const` by default, `let` only when reassignment is needed
- Prefer named exports over default exports
- Keep functions small and focused

## Submitting Changes

### Pull Requests

1. Create a feature branch from `main`: `git checkout -b feat/my-feature`
2. Make your changes with clear, descriptive commits
3. Run `pnpm typecheck` and `pnpm test` before pushing
4. Open a PR with a clear description of what you changed and why

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add workspace search functionality
fix: terminal resize not propagating to PTY
docs: update architecture diagram
refactor: simplify WebSocket reconnection logic
```

### Issue Reports

When filing issues, please include:
- Steps to reproduce
- Expected vs actual behavior
- Your OS, Node.js version, and browser
- Relevant terminal/console output

## Architecture Decisions

Before making significant architecture changes, please open an issue to discuss the approach. Key areas to be aware of:

- **Database safety** — Migrations must be additive only (never DROP tables). Never delete `.db-wal` or `.db-shm` files.
- **WebSocket protocol** — All terminal I/O flows through a multiplexed WebSocket channel. Changes to the protocol must be backward-compatible.
- **State management** — The frontend uses Zustand stores. Keep stores focused on a single domain.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
