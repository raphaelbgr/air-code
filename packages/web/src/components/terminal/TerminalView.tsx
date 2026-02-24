import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useTerminalStore } from '@/stores/terminal.store';
import { terminalChannel } from '@/lib/terminal-channel';
import { TERMINAL_FONT_FAMILY, TERMINAL_THEME } from './terminal-config';

const TMUX_DEFAULT_COLS = 80;
const CHAR_WIDTH_RATIO = 0.6;
const CHAR_HEIGHT_RATIO = 1.2;

interface TerminalViewProps {
  sessionId: string;
  isSelected: boolean;
}

/**
 * Unified terminal view — stays mounted across tier switches.
 * Both active and passive modes use the same font size (scaled to fit 80 cols).
 * When selected: enables input, cursor blink, sends resize to tmux.
 * When deselected: disables input, no cursor blink, read-only stream.
 * Zero Terminal reconstruction on tier switch = zero lag.
 */
export function TerminalView({ sessionId, isSelected }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const setTerminalMeta = useTerminalStore((s) => s.setTerminalMeta);

  // Native wheel handler: must be addEventListener (not React onWheel) so it fires
  // BEFORE ReactFlow's native listener. Plain scroll → terminal scrolls (stop propagation).
  // Ctrl+scroll → bubbles to ReactFlow for canvas zoom (prevent xterm scroll via preventDefault).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const handler = (e: WheelEvent) => {
      if (e.ctrlKey) {
        // Ctrl+scroll: prevent xterm from scrolling, let event bubble to ReactFlow for zoom
        e.preventDefault();
      } else {
        // Plain scroll: stop propagation so ReactFlow doesn't pan, xterm scrolls its buffer
        e.stopPropagation();
      }
    };
    container.addEventListener('wheel', handler, { passive: false });
    return () => container.removeEventListener('wheel', handler);
  }, []);

  // Create terminal once on mount — same sizing for both modes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const { width, height } = container.getBoundingClientRect();
    const fittedFontSize = Math.floor(width / (TMUX_DEFAULT_COLS * CHAR_WIDTH_RATIO));
    const fontSize = Math.max(Math.min(fittedFontSize, 14), 8);
    const rows = Math.max(Math.floor(height / (fontSize * CHAR_HEIGHT_RATIO)), 10);

    const term = new Terminal({
      fontSize,
      fontFamily: TERMINAL_FONT_FAMILY,
      theme: TERMINAL_THEME,
      cursorBlink: false,
      scrollback: 1000,
      disableStdin: true,
      cols: TMUX_DEFAULT_COLS,
      rows,
    });

    term.open(container);
    termRef.current = term;

    // Ctrl+C: copy if text selected, otherwise send \x03 (interrupt) to PTY
    // Ctrl+V: let browser handle paste (xterm picks it up via paste event)
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      if (event.ctrlKey && event.key === 'c' && term.hasSelection()) {
        return false; // browser copies selection
      }
      if (event.ctrlKey && event.key === 'v') {
        return false; // browser pastes
      }
      return true;
    });

    // Subscribe with preview — live data only, no scrollback replay
    const unsubscribe = terminalChannel.subscribe(sessionId, (data) => {
      term.write(data);
    }, { preview: true });

    const removeConnectionHandler = terminalChannel.onConnectionChange((connected) => {
      setTerminalMeta(sessionId, { connected });
    });
    setTerminalMeta(sessionId, { connected: terminalChannel.connected });

    return () => {
      unsubscribe();
      removeConnectionHandler();
      term.dispose();
      termRef.current = null;
    };
  }, [sessionId, setTerminalMeta]);

  // Upgrade/downgrade based on selection — no Terminal reconstruction
  useEffect(() => {
    const term = termRef.current;
    if (!term || !isSelected) return;

    // Upgrade: enable input + cursor blink
    term.options.cursorBlink = true;
    term.options.disableStdin = false;
    term.focus();

    const inputDisposable = term.onData((data) => {
      terminalChannel.sendInput(sessionId, data);
    });

    // Tell tmux our size
    terminalChannel.sendResize(sessionId, term.cols, term.rows);
    setTerminalMeta(sessionId, { cols: term.cols, rows: term.rows });

    return () => {
      // Downgrade: disable input + cursor blink
      inputDisposable.dispose();
      term.options.cursorBlink = false;
      term.options.disableStdin = true;
    };
  }, [sessionId, isSelected, setTerminalMeta]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      onMouseDown={handleMouseDown}
    />
  );
}
