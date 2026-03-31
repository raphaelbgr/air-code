#!/usr/bin/env npx tsx
/**
 * Air Code Remote Terminal Agent
 *
 * Shares your local terminal through the Air Code web app.
 * Spawns a local PTY and streams I/O over WebSocket to SMS.
 *
 * Usage:
 *   npx tsx scripts/remote-agent.ts              # localhost:7331
 *   npx tsx scripts/remote-agent.ts 192.168.1.x # HOST:7331
 *   npx tsx scripts/remote-agent.ts HOST:PORT     # custom port
 */

import * as pty from 'node-pty';
import WebSocket from 'ws';
import { hostname } from 'node:os';

const IS_WINDOWS = process.platform === 'win32';

// ── Parse arguments ──

const arg = process.argv[2];

if (arg === '--help' || arg === '-h') {
  console.error(`
Air Code Remote Terminal Agent

Usage:
  npx tsx scripts/remote-agent.ts              # connects to localhost:7331
  npx tsx scripts/remote-agent.ts HOST         # connects to HOST:7331
  npx tsx scripts/remote-agent.ts HOST:PORT    # custom port
  `.trim());
  process.exit(0);
}

let host = 'localhost';
let port = 7331;

if (arg) {
  const parts = arg.split(':');
  host = parts[0];
  if (parts[1]) {
    port = parseInt(parts[1], 10);
    if (isNaN(port)) {
      console.error(`[agent] Invalid port: ${parts[1]}`);
      process.exit(1);
    }
  }
}

const shell = IS_WINDOWS ? 'powershell.exe' : 'bash';

// ── Spawn local PTY ──

const term = pty.spawn(shell, [], {
  name: 'xterm-256color',
  cols: 80,
  rows: 24,
  cwd: process.cwd(),
  env: { ...process.env, TERM: 'xterm-256color' } as Record<string, string>,
});

console.error(`[agent] Spawned ${shell} (PID ${term.pid})`);

// ── WebSocket connection with reconnect ──

let ws: WebSocket | null = null;
let sessionId: string | null = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30000;

function connect() {
  const wsUrl = `ws://${host}:${port}/ws/remote-terminal`;
  console.error(`[agent] Connecting to ${wsUrl} ...`);

  ws = new WebSocket(wsUrl);

  ws.on('open', () => {
    console.error('[agent] Connected. Registering...');
    reconnectDelay = 1000; // reset backoff

    ws!.send(JSON.stringify({
      type: 'remote:register',
      sessionId: '',
      hostname: hostname(),
      shell,
    }));
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      switch (msg.type) {
        case 'remote:registered':
          sessionId = msg.sessionId;
          console.error(`[agent] Registered! Session ID: ${sessionId}`);
          console.error('[agent] Your terminal is now shared. Press Ctrl+C to stop.');
          break;

        case 'terminal:input':
          if (msg.data) {
            term.write(msg.data);
          }
          break;

        case 'terminal:resize':
          if (msg.cols && msg.rows) {
            try {
              term.resize(msg.cols, msg.rows);
            } catch { /* ignore resize errors */ }
          }
          break;
      }
    } catch { /* ignore parse errors */ }
  });

  ws.on('close', () => {
    console.error(`[agent] Disconnected. Reconnecting in ${reconnectDelay / 1000}s...`);
    ws = null;
    setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
      connect();
    }, reconnectDelay);
  });

  ws.on('error', (err) => {
    console.error(`[agent] WebSocket error: ${err.message}`);
    // 'close' event will fire after this and trigger reconnect
  });
}

// ── Pipe PTY output to WebSocket ──

term.onData((data: string) => {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'terminal:data',
      sessionId: sessionId || '',
      data,
    }));
  }
});

term.onExit(({ exitCode }) => {
  console.error(`[agent] Shell exited with code ${exitCode}`);
  if (ws) ws.close();
  process.exit(exitCode);
});

// ── Graceful shutdown ──

process.on('SIGINT', () => {
  console.error('\n[agent] Shutting down...');
  term.kill();
  if (ws) ws.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  term.kill();
  if (ws) ws.close();
  process.exit(0);
});

// ── Start ──

connect();
