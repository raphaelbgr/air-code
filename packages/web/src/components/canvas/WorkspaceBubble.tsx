import { memo, useCallback, useState } from 'react';
import { type NodeProps } from '@xyflow/react';
import { Folder, MessageSquare, TerminalSquare, Sparkles, Settings } from 'lucide-react';
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
  const openPanel = useCanvasStore((s) => s.openPanel);
  const [creatingShell, setCreatingShell] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showLauncher, setShowLauncher] = useState(false);

  const handleOpenShell = useCallback(async () => {
    if (!workspace.path || creatingShell) return;
    setCreatingShell(true);
    try {
      const session = await api.sessions.create({
        name: `${workspace.name} (shell)`,
        workspacePath: workspace.path,
        type: 'shell',
      });
      addSession(session);
      openPanel(session.id);
    } catch (err) {
      console.error('Failed to create shell session:', err);
    } finally {
      setCreatingShell(false);
    }
  }, [workspace, creatingShell, addSession, openPanel]);

  const handleClaudeCreated = useCallback((session: Session) => {
    addSession(session);
    openPanel(session.id);
  }, [addSession, openPanel]);

  return (
    <div
      className="w-full h-full rounded-2xl border-2 transition-colors"
      style={{
        borderColor: workspace.color + '60',
        backgroundColor: workspace.color + '08',
      }}
    >
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
              <button
                onClick={handleOpenShell}
                disabled={creatingShell}
                className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full transition-colors hover:bg-bg-tertiary text-text-muted hover:text-text-primary disabled:opacity-50"
                title="Open Terminal"
              >
                <TerminalSquare size={12} />
              </button>
              <button
                onClick={() => setShowLauncher(true)}
                className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full transition-colors hover:bg-bg-tertiary text-text-muted hover:text-text-primary"
                title="Open Claude Code"
              >
                <Sparkles size={12} />
              </button>
            </>
          )}
        </div>
      </div>

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
        />
      )}
    </div>
  );
});
