import { useEffect, useRef, type RefObject } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { useAuthStore } from '@/stores/auth.store';
import { useTerminalStore } from '@/stores/terminal.store';
import { createTerminalWs, sendTerminalInput, sendTerminalResize } from '@/lib/ws';
import type { WsMessage } from '@claude-air/shared';

export function useTerminal(sessionId: string, containerRef: RefObject<HTMLDivElement | null>) {
  const token = useAuthStore((s) => s.token);
  const setTerminalMeta = useTerminalStore((s) => s.setTerminalMeta);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !token) return;

    // Create terminal — using default DOM renderer (CanvasAddon removed:
    // it silently fails on some setups, leaving a black terminal)
    const term = new Terminal({
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      theme: {
        background: '#0a0a0f',
        foreground: '#e4e4e7',
        cursor: '#818cf8',
        selectionBackground: '#818cf840',
      },
      cursorBlink: true,
      scrollback: 5000,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const searchAddon = new SearchAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.loadAddon(searchAddon);

    term.open(container);

    // Defer first fit until the container has layout dimensions
    requestAnimationFrame(() => {
      fitAddon.fit();
    });

    termRef.current = term;
    fitRef.current = fitAddon;

    // WebSocket connection
    const ws = createTerminalWs(sessionId, token);
    wsRef.current = ws;

    ws.onopen = () => {
      setTerminalMeta(sessionId, { connected: true });
      // Send initial size after fit has had a chance to run
      requestAnimationFrame(() => {
        sendTerminalResize(ws, sessionId, term.cols, term.rows);
      });
    };

    ws.onmessage = (event) => {
      try {
        const msg: WsMessage = JSON.parse(event.data);
        if (msg.type === 'terminal:data' && msg.data) {
          term.write(msg.data);
        }
      } catch {
        // Binary data or malformed - write raw
        term.write(event.data);
      }
    };

    ws.onclose = () => {
      setTerminalMeta(sessionId, { connected: false });
    };

    // Input from terminal -> WebSocket
    term.onData((data) => {
      sendTerminalInput(ws, sessionId, data);
    });

    // Resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      setTerminalMeta(sessionId, { cols: term.cols, rows: term.rows });
      if (ws.readyState === WebSocket.OPEN) {
        sendTerminalResize(ws, sessionId, term.cols, term.rows);
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      ws.close();
      term.dispose();
      termRef.current = null;
      wsRef.current = null;
      fitRef.current = null;
    };
  }, [sessionId, token, containerRef, setTerminalMeta]);
}
