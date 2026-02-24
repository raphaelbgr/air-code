import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { useAuthStore } from '@/stores/auth.store';
import { useTerminalStore } from '@/stores/terminal.store';
import { createTerminalWs, sendTerminalInput, sendTerminalResize } from '@/lib/ws';
import type { WsMessage } from '@claude-air/shared';

interface MiniTerminalViewProps {
  sessionId: string;
  active: boolean;
}

/**
 * Primary embedded xterm.js terminal rendered inside each session node.
 * Full-featured: native font size, resize events sent to the server,
 * clickable URLs, search, cursor blink, and 5000-line scrollback.
 */
export function MiniTerminalView({ sessionId, active }: MiniTerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const token = useAuthStore((s) => s.token);
  const setTerminalMeta = useTerminalStore((s) => s.setTerminalMeta);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !token || !active) return;

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
    requestAnimationFrame(() => fitAddon.fit());

    // WebSocket connection
    const ws = createTerminalWs(sessionId, token);

    ws.onopen = () => {
      setTerminalMeta(sessionId, { connected: true });
      // Send initial size after fit
      requestAnimationFrame(() => {
        fitAddon.fit();
        sendTerminalResize(ws, sessionId, term.cols, term.rows);
        setTerminalMeta(sessionId, { cols: term.cols, rows: term.rows });
      });
    };

    ws.onmessage = (event) => {
      try {
        const msg: WsMessage = JSON.parse(event.data);
        if (msg.type === 'terminal:data' && msg.data) {
          term.write(msg.data);
        }
      } catch {
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

    // Resize: fit locally + send to server
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
    };
  }, [sessionId, token, active, setTerminalMeta]);

  // Stop wheel events from propagating to ReactFlow (canvas zoom)
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
  }, []);

  // Stop mousedown from propagating to ReactFlow (node drag)
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
    />
  );
}
