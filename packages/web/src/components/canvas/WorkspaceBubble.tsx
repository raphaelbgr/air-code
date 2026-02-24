import { memo, useCallback, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { type NodeProps, NodeResizer } from '@xyflow/react';
import { Folder, MessageSquare, TerminalSquare, Sparkles, Settings, ChevronDown } from 'lucide-react';
import type { Workspace, Session } from '@claude-air/shared';
import type { WorkspaceBubbleData } from '@/types';
import { api } from '@/lib/api';
import { useSessionStore } from '@/stores/session.store';
import { useCanvasStore } from '@/stores/canvas.store';
import { WorkspaceSettingsDialog } from '@/components/dialogs/WorkspaceSettingsDialog';
import { ClaudeLauncherDialog } from '@/components/dialogs/ClaudeLauncherDialog';

type Props = NodeProps & { data: WorkspaceBubbleData };

export const WorkspaceBubble = memo(function WorkspaceBubble({ data }: Props) {
  const { workspace: initialWorkspace, sessionCount, claudeSessionCount } = data;
  const [workspace, setWorkspace] = useState<Workspace>(initialWorkspace);
  const addSession = useSessionStore((s) => s.addSession);
  const setActiveSession = useCanvasStore((s) => s.setActiveSession);
  const [creating, setCreating] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showLauncher, setShowLauncher] = useState(false);
  const [launcherBackend, setLauncherBackend] = useState<'pty' | undefined>();
  const [showTermMenu, setShowTermMenu] = useState(false);
  const [showClaudeMenu, setShowClaudeMenu] = useState(false);
  const [resizing, setResizing] = useState(false);
  const termBtnRef = useRef<HTMLButtonElement>(null);
  const claudeBtnRef = useRef<HTMLButtonElement>(null);
  const termMenuRef = useRef<HTMLDivElement>(null);
  const claudeMenuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const handleOpenShell = useCallback(async () => {
    if (!workspace.path || creating) return;
    setCreating(true);
    setShowTermMenu(false);
    try {
      const session = await api.sessions.create({
        name: `${workspace.name} (shell)`,
        workspacePath: workspace.path,
        type: 'shell',
      });
      addSession(session);
      setActiveSession(session.id);
    } catch (err) {
      console.error('Failed to create shell session:', err);
    } finally {
      setCreating(false);
    }
  }, [workspace, creating, addSession, setActiveSession]);

  const handleClaudeCreated = useCallback((session: Session) => {
    addSession(session);
    setActiveSession(session.id);
  }, [addSession, setActiveSession]);

  const handleCreatePty = useCallback(async (type: 'shell' | 'claude') => {
    if (!workspace.path || creating) return;
    setCreating(true);
    setShowTermMenu(false);
    setShowClaudeMenu(false);
    try {
      const suffix = type === 'shell' ? '(pwsh)' : '(claude-ps)';
      const session = await api.sessions.create({
        name: `${workspace.name} ${suffix}`,
        workspacePath: workspace.path,
        type,
        backend: 'pty',
        skipPermissions: type === 'claude' ? workspace.settings?.skipPermissions : undefined,
        claudeArgs: type === 'claude' ? workspace.settings?.claudeArgs : undefined,
      });
      addSession(session);
      setActiveSession(session.id);
    } catch (err) {
      console.error('Failed to create PTY session:', err);
    } finally {
      setCreating(false);
    }
  }, [workspace, creating, addSession, setActiveSession]);

  const openMenu = useCallback((menu: 'term' | 'claude') => {
    const btnRef = menu === 'term' ? termBtnRef : claudeBtnRef;
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      setMenuPos({ top: rect.bottom + 4, left: rect.right });
    }
    if (menu === 'term') {
      setShowTermMenu((v) => !v);
      setShowClaudeMenu(false);
    } else {
      setShowClaudeMenu((v) => !v);
      setShowTermMenu(false);
    }
  }, []);

  // Close dropdowns on click outside
  useEffect(() => {
    if (!showTermMenu && !showClaudeMenu) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (showTermMenu && termMenuRef.current && !termMenuRef.current.contains(target) && !termBtnRef.current?.contains(target)) {
        setShowTermMenu(false);
      }
      if (showClaudeMenu && claudeMenuRef.current && !claudeMenuRef.current.contains(target) && !claudeBtnRef.current?.contains(target)) {
        setShowClaudeMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showTermMenu, showClaudeMenu]);

  return (
    <div
      className={`w-full h-full rounded-2xl border-2 transition-colors ${resizing ? 'is-resizing' : ''}`}
      style={{
        borderColor: workspace.color + '60',
        backgroundColor: workspace.color + '08',
      }}
    >
      <NodeResizer
        minWidth={400}
        minHeight={300}
        color={workspace.color}
        onResizeStart={() => setResizing(true)}
        onResizeEnd={() => setResizing(false)}
        handleStyle={{
          backgroundColor: workspace.color,
          width: 8,
          height: 8,
          borderRadius: 4,
          opacity: resizing ? 1 : 0,
          transition: 'opacity 0.15s',
        }}
      />
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-3 rounded-t-2xl"
        style={{ backgroundColor: workspace.color + '15' }}
      >
        <Folder size={16} style={{ color: workspace.color }} />
        <span className="font-semibold text-text-primary text-sm">
          {workspace.name}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {claudeSessionCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-text-muted bg-bg-tertiary px-2 py-0.5 rounded-full">
              <MessageSquare size={10} />
              {claudeSessionCount} chat{claudeSessionCount !== 1 ? 's' : ''}
            </span>
          )}
          <span className="text-xs text-text-muted bg-bg-tertiary px-2 py-0.5 rounded-full">
            {sessionCount} session{sessionCount !== 1 ? 's' : ''}
          </span>
          {workspace.path && (
            <>
              <button
                onClick={() => setShowSettings(true)}
                className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full transition-colors hover:bg-bg-tertiary text-text-muted hover:text-text-primary"
                title="Workspace Settings"
              >
                <Settings size={12} />
              </button>
              {/* Terminal dropdown trigger */}
              <div className="nodrag">
                <button
                  ref={termBtnRef}
                  onClick={() => openMenu('term')}
                  disabled={creating}
                  className="flex items-center gap-0.5 text-xs px-2 py-0.5 rounded-full transition-colors hover:bg-bg-tertiary text-text-muted hover:text-text-primary disabled:opacity-50"
                  title="Open Terminal"
                >
                  <TerminalSquare size={12} />
                  <ChevronDown size={10} />
                </button>
              </div>
              {/* Code Assistant dropdown trigger */}
              <div className="nodrag">
                <button
                  ref={claudeBtnRef}
                  onClick={() => openMenu('claude')}
                  disabled={creating}
                  className="flex items-center gap-0.5 text-xs px-2 py-0.5 rounded-full transition-colors hover:bg-bg-tertiary text-text-muted hover:text-text-primary disabled:opacity-50"
                  title="Open Code Assistant"
                >
                  <Sparkles size={12} />
                  <ChevronDown size={10} />
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Dropdown portals — rendered outside React Flow's stacking context */}
      {showTermMenu && createPortal(
        <div
          ref={termMenuRef}
          className="fixed bg-bg-secondary border border-border rounded-lg shadow-lg py-1 min-w-[200px]"
          style={{ top: menuPos.top, left: menuPos.left, transform: 'translateX(-100%)', zIndex: 9999 }}
        >
          <button
            onClick={() => handleCreatePty('shell')}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-text-primary hover:bg-bg-tertiary transition-colors"
            title="Native Windows PowerShell — ephemeral, dies with server"
          >
            <span className="font-mono text-[10px] text-text-muted w-5">PS&gt;</span>
            PowerShell Terminal
          </button>
          <button
            onClick={handleOpenShell}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-text-primary hover:bg-bg-tertiary transition-colors"
            title="Linux shell via WSL — survives server restarts"
          >
            <TerminalSquare size={12} className="text-text-muted w-5" />
            WSL Terminal (tmux)
          </button>
        </div>,
        document.body,
      )}

      {showClaudeMenu && createPortal(
        <div
          ref={claudeMenuRef}
          className="fixed bg-bg-secondary border border-border rounded-lg shadow-lg py-1 min-w-[200px]"
          style={{ top: menuPos.top, left: menuPos.left, transform: 'translateX(-100%)', zIndex: 9999 }}
        >
          <div className="text-[10px] text-text-muted uppercase tracking-wider px-3 py-1">Claude Code</div>
          <div className="border-t border-border mx-2 my-0.5" />
          <button
            onClick={() => { setShowClaudeMenu(false); setLauncherBackend('pty'); setShowLauncher(true); }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-text-primary hover:bg-bg-tertiary transition-colors"
            title="Run Claude Code in native PowerShell"
          >
            <span className="font-mono text-[10px] text-text-muted w-5">PS&gt;</span>
            Open in PowerShell
          </button>
          <button
            onClick={() => { setShowClaudeMenu(false); setLauncherBackend(undefined); setShowLauncher(true); }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-text-primary hover:bg-bg-tertiary transition-colors"
            title="Run Claude Code in WSL — browse & resume previous sessions"
          >
            <TerminalSquare size={12} className="text-text-muted w-5" />
            Open in WSL (tmux)
          </button>
        </div>,
        document.body,
      )}

      {/* Workspace path + description */}
      <div className="px-4 mt-1 space-y-0.5">
        {workspace.path && (
          <p className="text-text-muted text-[10px] font-mono truncate" title={workspace.path}>
            {workspace.path}
          </p>
        )}
        {workspace.description && (
          <p className="text-text-muted text-xs">{workspace.description}</p>
        )}
      </div>

      {showSettings && (
        <WorkspaceSettingsDialog
          workspace={workspace}
          onClose={() => setShowSettings(false)}
          onSaved={(updated) => setWorkspace(updated)}
        />
      )}

      {showLauncher && (
        <ClaudeLauncherDialog
          workspace={workspace}
          onClose={() => setShowLauncher(false)}
          onCreated={handleClaudeCreated}
          backend={launcherBackend}
        />
      )}
    </div>
  );
});
