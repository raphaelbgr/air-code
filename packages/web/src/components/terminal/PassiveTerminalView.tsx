import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { terminalChannel } from '@/lib/terminal-channel';
import { TERMINAL_FONT_FAMILY, TERMINAL_THEME } from './terminal-config';

// tmux default dimensions — passive terminals match this so output doesn't wrap wrong
const TMUX_DEFAULT_COLS = 80;
const TMUX_DEFAULT_ROWS = 24;
const CHAR_WIDTH_RATIO = 0.6; // monospace character width / font size

interface PassiveTerminalViewProps {
  sessionId: string;
}

/**
 * Lightweight read-only terminal stream for non-selected sessions.
 * Uses tmux default 80x24 with font scaled to fit the container width.
 * Zero addons, zero ResizeObservers, zero input handlers.
 * Subscribes with preview: true so SMS skips scrollback replay.
 */
export function PassiveTerminalView({ sessionId }: PassiveTerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Scale font so 80 cols fits within the container width
    const { width } = container.getBoundingClientRect();
    const fittedFontSize = Math.floor(width / (TMUX_DEFAULT_COLS * CHAR_WIDTH_RATIO));
    const fontSize = Math.max(Math.min(fittedFontSize, 14), 8);

    const term = new Terminal({
      fontSize,
      fontFamily: TERMINAL_FONT_FAMILY,
      theme: TERMINAL_THEME,
      cursorBlink: false,
      scrollback: 200,
      disableStdin: true,
      cols: TMUX_DEFAULT_COLS,
      rows: TMUX_DEFAULT_ROWS,
    });

    term.open(container);
    // No resize call — fixed at 80x24, no resize events sent to server

    // Subscribe with preview: true — SMS skips scrollback replay
    const unsubscribe = terminalChannel.subscribe(sessionId, (data) => {
      term.write(data);
    }, { preview: true });

    return () => {
      unsubscribe();
      term.dispose();
    };
  }, [sessionId]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
  }, []);

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
