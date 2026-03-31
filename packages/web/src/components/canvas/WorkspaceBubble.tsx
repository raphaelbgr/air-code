import { memo, useCallback, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { type NodeProps, NodeResizer } from '@xyflow/react';
import { Folder, FolderMinus, MessageSquare, TerminalSquare, Sparkles, Settings, ChevronDown, Trash2 } from 'lucide-react';
import type { Workspace, Session, CliProviderId } from '@air-code/shared';
import { getAllCliProviders, DEFAULT_CLI_PROVIDER } from '@air-code/shared';
import type { WorkspaceBubbleData } from '@/types';
import { api } from '@/lib/api';
import { useSessionStore } from '@/stores/session.store';
import { useCanvasStore } from '@/stores/canvas.store';
import { WorkspaceSettingsDialog } from '@/components/dialogs/WorkspaceSettingsDialog';
import { LauncherDialog } from '@/components/dialogs/LauncherDialog';

type Props = NodeProps & { data: WorkspaceBubbleData };

export const WorkspaceBubble = memo(function WorkspaceBubble({ data }: Props) {
  const { workspace: initialWorkspace, sessionCount, cliSessionCount } = data;
  const [workspace, setWorkspace] = useState<Workspace>(initialWorkspace);
  const sessions = useSessionStore((s) => s.sessions);
  const addSession = useSessionStore((s) => s.addSession);
  const removeSession = useSessionStore((s) => s.removeSession);
  const removeWorkspace = useSessionStore((s) => s.removeWorkspace);
  const setActiveSession = useCanvasStore((s) => s.setActiveSession);
  const [creating, setCreating] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showRemove, setShowRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [showLauncher, setShowLauncher] = useState(false);
  const [launcherBackend, setLauncherBackend] = useState<'pty' | undefined>();
  const [launcherCliProvider, setLauncherCliProvider] = useState<CliProviderId>(DEFAULT_CLI_PROVIDER);
  const [showTermMenu, setShowTermMenu] = useState(false);
  const [showCliMenu, setShowCliMenu] = useState(false);
  const [showKillAll, setShowKillAll] = useState(false);
  const [killingAll, setKillingAll] = useState(false);
  const [resizing, setResizing] = useState(false);
  const termBtnRef = useRef<HTMLButtonElement>(null);
  const cliBtnRef = useRef<HTMLButtonElement>(null);
  const termMenuRef = useRef<HTMLDivElement>(null);
  const cliMenuRef = useRef<HTMLDivElement>(null);
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

  const handleCliCreated = useCallback((session: Session) => {
    addSession(session);
    setActiveSession(session.id);
  }, [addSession, setActiveSession]);

  const handleCreatePty = useCallback(async (type: 'shell' | 'cli') => {
    if (!workspace.path || creating) return;
    setCreating(true);
    setShowTermMenu(false);
    setShowCliMenu(false);
    try {
      const suffix = type === 'shell' ? '(pwsh)' : '(cli-ps)';
      const session = await api.sessions.create({
        name: `${workspace.name} ${suffix}`,
        workspacePath: workspace.path,
        type,
        backend: 'pty',
        skipPermissions: type === 'cli' ? (workspace.settings?.skipPermissions?.['claude'] ?? false) : undefined,
        cliArgs: type === 'cli' ? workspace.settings?.cliArgs : undefined,
        cliProvider: type === 'cli' ? workspace.settings?.cliProvider : undefined,
      });
      addSession(session);
      setActiveSession(session.id);
    } catch (err) {
      console.error('Failed to create PTY session:', err);
    } finally {
      setCreating(false);
    }
  }, [workspace, creating, addSession, setActiveSession]);

  const openMenu = useCallback((menu: 'term' | 'cli') => {
    const btnRef = menu === 'term' ? termBtnRef : cliBtnRef;
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      setMenuPos({ top: rect.bottom + 4, left: rect.right });
    }
    if (menu === 'term') {
      setShowTermMenu((v) => !v);
      setShowCliMenu(false);
    } else {
      setShowCliMenu((v) => !v);
      setShowTermMenu(false);
    }
  }, []);

  const norm = (p: string) => p.toLowerCase().replace(/\//g, '\\');
  const workspaceSessions = workspace.path
    ? sessions.filter((s) => s.workspacePath && norm(s.workspacePath) === norm(workspace.path!))
    : [];

  const handleKillAll = useCallback(async () => {
    if (killingAll) return;
    setKillingAll(true);
    try {
      await Promise.allSettled(
        workspaceSessions.map((s) =>
          api.sessions.kill(s.id).then(() => removeSession(s.id)),
        ),
      );
    } catch (err) {
      console.error('Kill all sessions failed:', err);
    } finally {
      setKillingAll(false);
      setShowKillAll(false);
    }
  }, [killingAll, workspaceSessions, removeSession]);

  const handleRemoveWorkspace = useCallback(async () => {
    if (removing) return;
    setRemoving(true);
    try {
      await api.workspaces.delete(workspace.id);
      removeWorkspace(workspace.id);
    } catch (err) {
      console.error('Failed to remove workspace:', err);
    } finally {
      setRemoving(false);
      setShowRemove(false);
    }
  }, [removing, workspace.id, removeWorkspace]);

  // Close dropdowns on click outside
  useEffect(() => {
    if (!showTermMenu && !showCliMenu) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (showTermMenu && termMenuRef.current && !termMenuRef.current.contains(target) && !termBtnRef.current?.contains(target)) {
        setShowTermMenu(false);
      }
      if (showCliMenu && cliMenuRef.current && !cliMenuRef.current.contains(target) && !cliBtnRef.current?.contains(target)) {
        setShowCliMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showTermMenu, showCliMenu]);

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
          {cliSessionCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-text-muted bg-bg-tertiary px-2 py-0.5 rounded-full">
              <MessageSquare size={10} />
              {cliSessionCount} chat{cliSessionCount !== 1 ? 's' : ''}
            </span>
          )}
          <span className="text-xs text-text-muted bg-bg-tertiary px-2 py-0.5 rounded-full">
            {sessionCount} session{sessionCount !== 1 ? 's' : ''}
          </span>
          {workspace.path && (
            <>
              <div className="nodrag">
                <button
                  onClick={() => setShowRemove(true)}
                  className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full transition-colors hover:bg-red-500/20 text-text-muted hover:text-red-400"
                  title="Remove Workspace"
                >
                  <FolderMinus size={12} />
                </button>
              </div>
              <div className="nodrag">
                <button
                  onClick={() => setShowKillAll(true)}
                  disabled={workspaceSessions.length === 0}
                  className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full transition-colors hover:bg-red-500/20 text-text-muted hover:text-red-400 disabled:opacity-30 disabled:pointer-events-none"
                  title="Kill All Sessions"
                >
                  <Trash2 size={12} />
                </button>
              </div>
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
                  ref={cliBtnRef}
                  onClick={() => openMenu('cli')}
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

      {showCliMenu && createPortal(
        <div
          ref={cliMenuRef}
          className="fixed bg-bg-secondary border border-border rounded-lg shadow-lg py-1 min-w-[200px]"
          style={{ top: menuPos.top, left: menuPos.left, transform: 'translateX(-100%)', zIndex: 9999 }}
        >
          {getAllCliProviders().map((p, i) => (
            <div key={p.id}>
              {i > 0 && <div className="border-t border-border mx-2 my-1" />}
              <div className="text-[10px] text-text-muted uppercase tracking-wider px-3 py-1">
                {p.displayName}
              </div>
              <div className="border-t border-border mx-2 my-0.5" />
              <button
                onClick={() => { setShowCliMenu(false); setLauncherBackend('pty'); setLauncherCliProvider(p.id); setShowLauncher(true); }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-text-primary hover:bg-bg-tertiary transition-colors"
                title={`Run ${p.displayName} in native PowerShell`}
              >
                <span className="font-mono text-[10px] text-text-muted w-5">PS&gt;</span>
                Open in PowerShell
              </button>
              <button
                onClick={() => { setShowCliMenu(false); setLauncherBackend(undefined); setLauncherCliProvider(p.id); setShowLauncher(true); }}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-text-primary hover:bg-bg-tertiary transition-colors"
                title={`Run ${p.displayName} in WSL — browse & resume previous sessions`}
              >
                <TerminalSquare size={12} className="text-text-muted w-5" />
                Open in WSL (tmux)
              </button>
            </div>
          ))}
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
        <LauncherDialog
          workspace={workspace}
          onClose={() => setShowLauncher(false)}
          onCreated={handleCliCreated}
          backend={launcherBackend}
          cliProvider={launcherCliProvider}
        />
      )}

      {showKillAll && createPortal(
        <div className="fixed inset-0 flex items-center justify-center bg-black/50" style={{ zIndex: 9999 }}>
          <div className="w-full max-w-sm p-6 rounded-2xl bg-bg-secondary border border-border">
            <h3 className="text-sm font-semibold text-text-primary mb-3">Kill All Sessions</h3>
            <p className="text-xs text-text-muted mb-1">
              This will kill <strong className="text-text-primary">{workspaceSessions.length}</strong> session{workspaceSessions.length !== 1 ? 's' : ''} in <strong className="text-text-primary">{workspace.name}</strong>:
            </p>
            <ul className="text-xs text-text-muted mb-4 space-y-0.5 ml-3 list-disc">
              <li>All terminal processes will be terminated</li>
              <li>Running tmux sessions will be destroyed</li>
              <li>PowerShell (PTY) sessions will be killed</li>
              <li>Any unsaved work in those terminals will be lost</li>
            </ul>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowKillAll(false)}
                disabled={killingAll}
                className="px-3 py-1.5 text-xs rounded-lg bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleKillAll}
                disabled={killingAll}
                className="px-3 py-1.5 text-xs rounded-lg bg-red-600 text-white hover:bg-red-500 transition-colors disabled:opacity-50"
              >
                {killingAll ? 'Killing...' : 'Kill All'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {showRemove && createPortal(
        <div className="fixed inset-0 flex items-center justify-center bg-black/50" style={{ zIndex: 9999 }}>
          <div className="w-full max-w-sm p-6 rounded-2xl bg-bg-secondary border border-border">
            <h3 className="text-sm font-semibold text-text-primary mb-3">Remove Workspace</h3>
            <p className="text-xs text-text-muted mb-1">
              Remove <strong className="text-text-primary">{workspace.name}</strong> from Air Code?
            </p>
            <ul className="text-xs text-text-muted mb-4 space-y-0.5 ml-3 list-disc">
              <li>All running sessions will be killed</li>
              <li>The workspace will be removed from the canvas</li>
              <li><strong className="text-text-primary">Your files are NOT deleted</strong> — the folder remains on disk</li>
              <li>You can re-import it anytime via "Detect Workspaces"</li>
            </ul>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowRemove(false)}
                disabled={removing}
                className="px-3 py-1.5 text-xs rounded-lg bg-bg-tertiary text-text-muted hover:text-text-primary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRemoveWorkspace}
                disabled={removing}
                className="px-3 py-1.5 text-xs rounded-lg bg-red-600 text-white hover:bg-red-500 transition-colors disabled:opacity-50"
              >
                {removing ? 'Removing...' : 'Remove'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
});
