import { useState, useCallback, useRef, useEffect } from 'react';
import { X, Minus, Copy, Check, RefreshCw, Monitor, Trash2 } from 'lucide-react';
import { useCanvasStore } from '@/stores/canvas.store';
import { useSessionStore } from '@/stores/session.store';
import { useTerminalStore } from '@/stores/terminal.store';
import { api } from '@/lib/api';
import { TerminalView } from './TerminalView';

const MIN_HEIGHT = 150;
const MAX_HEIGHT_RATIO = 0.85; // max 85% of viewport
const DEFAULT_HEIGHT = 350;

export function TerminalPanel() {
  const { panelOpen, panelTabs, activeSessionId, setActiveSession, closePanelTab, closePanel } = useCanvasStore();
  const sessions = useSessionStore((s) => s.sessions);
  const removeSession = useSessionStore((s) => s.removeSession);
  const isConnected = useTerminalStore((s) => s.isConnected);
  const [copied, setCopied] = useState(false);
  const [showJoinInfo, setShowJoinInfo] = useState(false);
  const [reattaching, setReattaching] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [panelHeight, setPanelHeight] = useState(DEFAULT_HEIGHT);
  const isDragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const connected = activeSessionId ? isConnected(activeSessionId) : false;

  const [copyTarget, setCopyTarget] = useState<'win' | 'unix'>('win');

  const handleCopy = useCallback(async (target?: 'win' | 'unix') => {
    if (!activeSession) return;
    const t = target || copyTarget;
    const cmd = t === 'win'
      ? `wsl tmux attach -t ${activeSession.tmuxSession}`
      : `tmux attach -t ${activeSession.tmuxSession}`;
    await navigator.clipboard.writeText(cmd);
    setCopyTarget(t);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [activeSession, copyTarget]);

  const handleReattach = useCallback(async () => {
    if (!activeSessionId || reattaching) return;
    setReattaching(true);
    try {
      await api.sessions.reattach(activeSessionId);
    } catch (err) {
      console.error('Reattach failed:', err);
    } finally {
      setReattaching(false);
    }
  }, [activeSessionId, reattaching]);

  const handleDelete = useCallback(async () => {
    if (!activeSessionId || deleting) return;
    setDeleting(true);
    try {
      await api.sessions.kill(activeSessionId);
      removeSession(activeSessionId);
      closePanelTab(activeSessionId);
    } catch (err) {
      console.error('Delete session failed:', err);
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }, [activeSessionId, deleting, removeSession, closePanelTab]);

  // Drag resize handlers
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    startY.current = e.clientY;
    startHeight.current = panelHeight;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, [panelHeight]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = startY.current - e.clientY;
      const maxHeight = window.innerHeight * MAX_HEIGHT_RATIO;
      const newHeight = Math.min(maxHeight, Math.max(MIN_HEIGHT, startHeight.current + delta));
      setPanelHeight(newHeight);
    };

    const handleMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  if (!panelOpen || panelTabs.length === 0) return null;

  return (
    <div
      className="border-t border-border bg-bg-secondary flex flex-col shrink-0"
      style={{ height: panelHeight }}
    >
      {/* Resize handle */}
      <div
        onMouseDown={handleDragStart}
        className="h-1 cursor-row-resize hover:bg-accent/40 transition-colors shrink-0 group flex items-center justify-center"
      >
        <div className="w-8 h-0.5 rounded-full bg-border group-hover:bg-accent/60 transition-colors" />
      </div>

      {/* Tab bar */}
      <div className="flex items-center border-b border-border bg-bg-tertiary overflow-x-auto shrink-0">
        {panelTabs.map((sessionId) => {
          const session = sessions.find((s) => s.id === sessionId);
          const isActive = activeSessionId === sessionId;
          return (
            <div
              key={sessionId}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm cursor-pointer border-r border-border transition ${
                isActive
                  ? 'bg-bg-secondary text-text-primary'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
              onClick={() => setActiveSession(sessionId)}
            >
              <span className="truncate max-w-[120px]">{session?.name || 'Session'}</span>
              <button
                onClick={(e) => { e.stopPropagation(); closePanelTab(sessionId); }}
                className="text-text-muted hover:text-text-primary ml-1"
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
        <div className="flex-1" />

        {/* Status + actions */}
        {activeSession && (
          <div className="flex items-center gap-1 px-2">
            <span className={`w-1.5 h-1.5 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-[10px] text-text-muted mr-1">
              {connected ? 'Live' : 'Disconnected'}
            </span>

            {!connected && (
              <button
                onClick={handleReattach}
                disabled={reattaching}
                className="flex items-center gap-1 text-[10px] text-accent hover:text-accent-hover px-1.5 py-0.5 rounded transition disabled:opacity-50"
                title="Reconnect terminal stream"
              >
                <RefreshCw size={10} className={reattaching ? 'animate-spin' : ''} />
                Reconnect
              </button>
            )}

            <button
              onClick={() => setShowJoinInfo(!showJoinInfo)}
              className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded transition ${
                showJoinInfo
                  ? 'bg-accent/20 text-accent'
                  : 'text-text-muted hover:text-text-primary'
              }`}
              title="Join this terminal locally"
            >
              <Monitor size={10} />
              Local
            </button>

            <button
              onClick={() => setConfirmDelete(true)}
              className="flex items-center gap-1 text-[10px] text-text-muted hover:text-red-400 px-1.5 py-0.5 rounded transition"
              title="Delete session"
            >
              <Trash2 size={10} />
            </button>
          </div>
        )}

        <button
          onClick={closePanel}
          className="px-2 py-1.5 text-text-muted hover:text-text-primary"
          title="Minimize panel"
        >
          <Minus size={14} />
        </button>
      </div>

      {/* Join locally info bar */}
      {showJoinInfo && activeSession && (
        <div className="flex flex-col gap-1.5 px-3 py-2 bg-accent/5 border-b border-accent/20 text-xs shrink-0">
          <span className="text-text-muted">
            Join this terminal locally — both local and web terminals share the same session in real-time.
          </span>
          <div className="flex items-center gap-2">
            <span className="text-text-muted w-20 shrink-0">Windows:</span>
            <code className="bg-bg-tertiary px-2 py-0.5 rounded font-mono text-text-primary">
              wsl tmux attach -t {activeSession.tmuxSession}
            </code>
            <button
              onClick={() => handleCopy('win')}
              className="flex items-center gap-1 text-accent hover:text-accent-hover transition shrink-0"
              title="Copy Windows command"
            >
              {copied && copyTarget === 'win' ? <Check size={12} /> : <Copy size={12} />}
              {copied && copyTarget === 'win' ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-text-muted w-20 shrink-0">macOS/Linux:</span>
            <code className="bg-bg-tertiary px-2 py-0.5 rounded font-mono text-text-primary">
              tmux attach -t {activeSession.tmuxSession}
            </code>
            <button
              onClick={() => handleCopy('unix')}
              className="flex items-center gap-1 text-accent hover:text-accent-hover transition shrink-0"
              title="Copy macOS/Linux command"
            >
              {copied && copyTarget === 'unix' ? <Check size={12} /> : <Copy size={12} />}
              {copied && copyTarget === 'unix' ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && activeSession && (
        <div className="flex items-center gap-3 px-3 py-2 bg-red-500/10 border-b border-red-500/30 text-xs shrink-0">
          <span className="text-red-400">
            Kill session <strong>{activeSession.name}</strong> and its tmux process?
          </span>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="px-2 py-0.5 bg-red-500 hover:bg-red-600 text-white rounded transition text-xs disabled:opacity-50"
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
          <button
            onClick={() => setConfirmDelete(false)}
            className="px-2 py-0.5 text-text-muted hover:text-text-primary transition text-xs"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Terminal content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeSessionId && <TerminalView sessionId={activeSessionId} />}
      </div>
    </div>
  );
}
