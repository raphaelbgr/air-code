import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useAuthStore } from '@/stores/auth.store';
import { createTerminalWs, sendTerminalInput, sendTerminalResize } from '@/lib/ws';
import type { WsMessage } from '@claude-air/shared';

interface MiniTerminalViewProps {
  sessionId: string;
  active: boolean;
}

/**
 * Tiny embedded xterm.js terminal for session node previews.
 * Interactive (sends input and resize) so the tmux pane matches
 * the mini viewport. When the full panel opens, its larger resize
 * takes over.
 */
export function MiniTerminalView({ sessionId, active }: MiniTerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const token = useAuthStore((s) => s.token);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !token || !active) return;

    const term = new Terminal({
      fontSize: 9,
      lineHeight: 1.1,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      theme: {
        background: '#0a0a0f',
        foreground: '#e4e4e7',
        cursor: '#818cf8',
        selectionBackground: '#818cf840',
      },
      cursorBlink: false,
      scrollback: 200,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    requestAnimationFrame(() => fitAddon.fit());

    const ws = createTerminalWs(sessionId, token, { preview: true });

    ws.onopen = () => {
      // Send initial resize so tmux adjusts to mini viewport dimensions
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
        term.write(event.data);
      }
    };

    // Interactive: input goes to session
    term.onData((data) => {
      sendTerminalInput(ws, sessionId, data);
    });

    // Fit locally and send resize to server
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
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
  }, [sessionId, token, active]);

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
