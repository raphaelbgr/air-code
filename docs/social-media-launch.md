# Air Code v0.1.0 — Social Media Launch Posts

**Repo:** https://github.com/raphaelbgr/air-code
**Author:** @raphaelbgr (X) / linkedin.com/in/raphaelbgr
**Screenshot:** `docs/screenshot.png` (attach to main thread + LinkedIn)

---

## X/Twitter Thread (Posts 1-5)

### Post 1 — Main Announcement (Pin this)

Introducing Air Code — a web-based canvas for managing multiple AI terminal sessions side by side.

Drag, resize, organize. Watch live output. Fork conversations. Collaborate in real-time.

Works with @claudeai, Gemini CLI, SSH, or any terminal.

Open source. MIT licensed.

https://github.com/raphaelbgr/air-code

@AnthropicAI @bcherny @noahzweben #ClaudeCode #vibecoding #buildinpublic

---

### Post 2 — The Vision

The goal: a "Claude Code of Claude Codes."

Decoupled by design — the session server runs on your coding machine at home, the web UI connects to it from anywhere. Access your terminals from your laptop, phone, or a colleague's browser.

Multiple programmers, same canvas, different projects. Connect your terminal via reverse SSH tunnel — let others participate or just watch.

An AI agent with MCP is on the roadmap to orchestrate ALL sessions from one place.

---

### Post 3 — Features

What's in v0.1.0:

- Canvas UI with workspace bubbles (ReactFlow)
- Live xterm.js terminals via WebSocket
- tmux persistence (sessions survive restarts)
- Session forking (branch conversations like git)
- Auto-detect Claude projects from ~/.claude/projects/
- Multi-user presence (see who's watching)
- Remote terminal sharing from any machine
- Decoupled architecture — session server at home, web UI from anywhere
- Works on Windows + WSL natively

---

### Post 4 — Tech Stack

Built with:

React 19 + TypeScript + Zustand
Node.js 22 + Express + SQLite (WAL mode)
xterm.js + WebSocket multiplexing
ReactFlow (canvas)
Tailwind CSS v4
Socket.IO (presence)

3-server monorepo architecture: Browser → WAS → SMS → tmux/PTY

Decoupled by design — SMS (session manager) runs on your dev machine, WAS (web app) connects to it from anywhere. Code at home, access from any browser.

@alexalbert__ @simonw @swyx @karpathy @NetworkChuck @IndyDevDan

---

### Post 5 — Call to Action

Air Code is just getting started. Looking for contributors who care about:

- Multi-agent terminal orchestration
- Real-time collaboration for AI-assisted development
- MCP integrations for cross-session communication
- Making terminal-based AI tools work together

Star, fork, contribute: https://github.com/raphaelbgr/air-code

#opensource #devtools #agenticcoding #AIcoding

---

## Standalone Tweet (Short Version)

I built a web canvas where you manage multiple AI terminal sessions side by side — Claude Code, Gemini CLI, SSH, anything.

Fork conversations. Watch live output. Collaborate in real-time. Connect remote terminals via WebSocket.

Decoupled architecture — session server runs at home, connect from any browser anywhere.

Open source: https://github.com/raphaelbgr/air-code

@AnthropicAI @claudeai @NetworkChuck #ClaudeCode #vibecoding

---

## Reply to Claude Code Remote Control Thread

> Find @noahzweben's Feb 25 announcement about Remote Control and reply with:

This pairs perfectly with Air Code — a self-hosted canvas for managing multiple Claude Code sessions visually.

Multiple devs, multiple projects, one canvas. Fork sessions, watch live output, connect remote terminals.

Works with any terminal CLI, not just Claude.

https://github.com/raphaelbgr/air-code

@noahzweben @bcherny

---

## LinkedIn Post

**Introducing Air Code — A Visual Canvas for AI Terminal Sessions**

After months of working with Claude Code and other AI CLIs, I kept hitting the same problem: managing multiple terminal sessions across projects was chaos. Tab switching, lost context, no visibility into what's running where.

So I built Air Code — an open-source web canvas where you can manage all your AI terminal sessions side by side.

**What it does today (v0.1.0):**
- Canvas-based UI — drag, resize, and organize session cards into workspace bubbles
- Real-time terminal streaming via WebSocket multiplexing
- Works with Claude Code, Gemini CLI, SSH terminals, or any shell
- Session forking — branch AI conversations like git branches
- Auto-detect existing Claude projects from ~/.claude/projects/
- Multi-user presence — see who's viewing which session in real-time
- Remote terminal sharing — connect any machine's terminal to the canvas
- Decoupled architecture — session server runs on your dev machine at home, the web UI connects to it from anywhere
- Persistent tmux sessions that survive server restarts
- Windows + WSL first-class support

**The bigger vision:**
Air Code is building toward being the orchestration layer for AI-assisted terminal development. Think "Claude Code of Claude Codes" — multiple programmers coding side by side, same or different projects. The architecture is decoupled by design: the session manager (SMS) runs on your coding machine, and the web server (WAS) connects to it remotely. Access your terminals from any browser, anywhere. Developers can also connect their terminals via reverse SSH tunnels to let others participate or observe. An AI agent with MCP (Model Context Protocol) integration is on the roadmap to enable cross-session communication and orchestration.

**Tech stack:** React 19, TypeScript, Node.js 22, xterm.js, ReactFlow, SQLite (WAL mode), WebSocket multiplexing, Socket.IO, Tailwind CSS v4. Monorepo with 3-server architecture.

Open source (MIT). Contributions welcome.

https://github.com/raphaelbgr/air-code

#ClaudeCode #OpenSource #DevTools #AIcoding #vibecoding #buildinpublic #agenticcoding

> **LinkedIn tagging tip:** Tag people in comments, not the post body (LinkedIn algorithm prefers this).
> Comment: "cc Anthropic, Claude AI, Boris Cherny, Alex Albert, Noah Zweben, Simon Willison, Andrej Karpathy, Andrew Ng"

---

## Accounts to Tag

### X/Twitter

| Account | Handle | Why |
|---------|--------|-----|
| Anthropic | @AnthropicAI | Parent company of Claude |
| Claude AI | @claudeai | Official Claude product account |
| Boris Cherny | @bcherny | Created Claude Code |
| Noah Zweben | @noahzweben | PM for Claude Code, announced Remote Control |
| Alex Albert | @alexalbert__ | Head of Claude Relations at Anthropic |
| Andrej Karpathy | @karpathy | Coined "vibe coding", 1.7M followers |
| Simon Willison | @simonw | Respected voice on LLM dev tools |
| swyx | @swyx | AI Engineer community leader |
| IndyDevDan | @IndyDevDan | Claude Code content creator |
| McKay Wrigley | @mckaywrigley | AI coding tutorials, 225K+ followers |
| Andrew Ng | @AndrewYNg | AI education leader |
| GitHub | @github | Open source platform |
| NetworkChuck | @NetworkChuck | Tech/networking influencer, homelab/self-hosted audience |
| Microsoft AI | @MicrosoftAI | Windows/WSL integration angle |

### LinkedIn

| Account | URL |
|---------|-----|
| Anthropic | linkedin.com/company/anthropicresearch |
| Claude | linkedin.com/showcase/claude |
| Dario Amodei | linkedin.com/in/dario-amodei-3934934 |
| Alex Albert | linkedin.com/in/alex-albert |
| Noah Zweben | linkedin.com/in/noahzweben |
| Andrew Ng | linkedin.com/in/andrewyng |

### Hashtags

`#ClaudeCode` `#vibecoding` `#buildinpublic` `#opensource` `#devtools` `#agenticcoding` `#AIcoding` `#MCP`

---

## Posting Strategy

1. **X/Twitter Thread** — Post 1-5 as a thread. Pin Post 1. Attach `docs/screenshot.png`
2. **Reply to Remote Control** — Find @noahzweben's Feb 25 announcement and reply
3. **LinkedIn** — Post the long-form version. Tag people in comments, not post body
4. **Timing** — Post during US morning hours (9-11am EST) for maximum reach
5. **Screenshot** — Attach `docs/screenshot.png` to main thread and LinkedIn post
