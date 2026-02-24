import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { useTerminalStore } from '@/stores/terminal.store';
import { terminalChannel } from '@/lib/terminal-channel';
import { TERMINAL_FONT_SIZE, TERMINAL_FONT_FAMILY, TERMINAL_THEME } from './terminal-config';

interface MiniTerminalViewProps {
  sessionId: string;
  active: boolean;
}

/**
 * Primary embedded xterm.js terminal rendered inside each session node.
 * Full-featured: native font size, resize events sent to the server,
 * clickable URLs, search, cursor blink, and 5000-line scrollback.
 * Uses the shared multiplexed terminal channel (1 WS for all sessions).
 */
export function MiniTerminalView({ sessionId, active }: MiniTerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const setTerminalMeta = useTerminalStore((s) => s.setTerminalMeta);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !active) return;

    const term = new Terminal({
      fontSize: TERMINAL_FONT_SIZE,
      fontFamily: TERMINAL_FONT_FAMILY,
      theme: TERMINAL_THEME,
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

    // Subscribe to terminal data via the multiplexed channel
    const unsubscribe = terminalChannel.subscribe(sessionId, (data) => {
      term.write(data);
    });

    // Track connection state
    const removeConnectionHandler = terminalChannel.onConnectionChange((connected) => {
      setTerminalMeta(sessionId, { connected });
      if (connected) {
        requestAnimationFrame(() => {
          fitAddon.fit();
          terminalChannel.sendResize(sessionId, term.cols, term.rows);
          setTerminalMeta(sessionId, { cols: term.cols, rows: term.rows });
        });
      }
    });

    // Set initial connection state
    setTerminalMeta(sessionId, { connected: terminalChannel.connected });
    if (terminalChannel.connected) {
      requestAnimationFrame(() => {
        fitAddon.fit();
        terminalChannel.sendResize(sessionId, term.cols, term.rows);
        setTerminalMeta(sessionId, { cols: term.cols, rows: term.rows });
      });
    }

    // Input from terminal -> channel
    term.onData((data) => {
      terminalChannel.sendInput(sessionId, data);
    });

    // Resize: fit locally + send to server
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      setTerminalMeta(sessionId, { cols: term.cols, rows: term.rows });
      terminalChannel.sendResize(sessionId, term.cols, term.rows);
    });
    resizeObserver.observe(container);

    return () => {
      unsubscribe();
      removeConnectionHandler();
      resizeObserver.disconnect();
      term.dispose();
    };
  }, [sessionId, active, setTerminalMeta]);

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
