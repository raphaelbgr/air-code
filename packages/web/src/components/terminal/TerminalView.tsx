import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useTerminalStore } from '@/stores/terminal.store';
import { terminalChannel } from '@/lib/terminal-channel';
import { createImagePasteHandler } from '@/lib/paste-image';
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

  // Fix xterm.js mouse coordinates under ReactFlow CSS transforms.
  // ReactFlow applies transform: translate(X,Y) scale(Z) on .react-flow__viewport.
  // xterm.js calculates cell position as: (clientX - rect.left) / cssCellWidth
  // getBoundingClientRect() returns the scaled rect, but cssCellWidth is unscaled,
  // so at zoom != 1 the cell calculation is wrong. We fix this by adjusting
  // clientX/clientY in the capture phase before xterm.js sees the events.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const adjustMouseCoords = (e: MouseEvent) => {
      // Read scale directly from the ReactFlow viewport transform
      const viewport = container.closest('.react-flow__viewport') as HTMLElement | null;
      if (!viewport) return;
      const match = viewport.style.transform.match(/scale\(([^)]+)\)/);
      const zoom = match ? parseFloat(match[1]) : 1;
      if (zoom === 1) return;

      const rect = container.getBoundingClientRect();
      // Convert screen-space offset to unscaled offset
      Object.defineProperty(e, 'clientX', {
        value: rect.left + (e.clientX - rect.left) / zoom,
      });
      Object.defineProperty(e, 'clientY', {
        value: rect.top + (e.clientY - rect.top) / zoom,
      });
    };

    // Capture phase fires before xterm.js's bubble-phase listeners
    container.addEventListener('mousedown', adjustMouseCoords, { capture: true });
    container.addEventListener('mousemove', adjustMouseCoords, { capture: true });
    container.addEventListener('mouseup', adjustMouseCoords, { capture: true });
    return () => {
      container.removeEventListener('mousedown', adjustMouseCoords, { capture: true });
      container.removeEventListener('mousemove', adjustMouseCoords, { capture: true });
      container.removeEventListener('mouseup', adjustMouseCoords, { capture: true });
    };
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

    // Subscribe with preview — live data only, no scrollback replay.
    // Batch writes via requestAnimationFrame to avoid starving the event loop
    // during high-frequency streaming (prevents click events from being dropped).
    let writeBuffer = '';
    let rafId: number | null = null;
    const unsubscribe = terminalChannel.subscribe(sessionId, (data) => {
      writeBuffer += data;
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          if (writeBuffer) {
            term.write(writeBuffer);
            writeBuffer = '';
          }
          rafId = null;
        });
      }
    }, { preview: true });

    const removeConnectionHandler = terminalChannel.onConnectionChange((connected) => {
      setTerminalMeta(sessionId, { connected });
    });
    setTerminalMeta(sessionId, { connected: terminalChannel.connected });

    return () => {
      unsubscribe();
      removeConnectionHandler();
      if (rafId !== null) cancelAnimationFrame(rafId);
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

    // Intercept image pastes (capture phase, before xterm sees it)
    const container = containerRef.current;
    const pasteHandler = createImagePasteHandler(sessionId);
    container?.addEventListener('paste', pasteHandler, { capture: true });

    return () => {
      // Downgrade: disable input + cursor blink
      inputDisposable.dispose();
      term.options.cursorBlink = false;
      term.options.disableStdin = true;
      container?.removeEventListener('paste', pasteHandler, { capture: true });
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
