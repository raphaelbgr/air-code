import { memo, useCallback, useState } from 'react';
import { type NodeProps, NodeResizer } from '@xyflow/react';
import { Terminal, Sparkles, Circle, Trash2, Monitor, Copy, Check, X, GitFork } from 'lucide-react';
import type { SessionNodeData } from '@/types';
import { useSessionStore } from '@/stores/session.store';
import { useCanvasStore } from '@/stores/canvas.store';
import { api } from '@/lib/api';
import { TerminalView } from '../terminal/TerminalView';
import { UserAvatarStack } from '../presence/UserAvatarStack';

type Props = NodeProps & { data: SessionNodeData };

const statusColors: Record<string, string> = {
  running: '#22c55e',
  idle: '#f59e0b',
  stopped: '#71717a',
  error: '#ef4444',
};

export const SessionNode = memo(function SessionNode({ data }: Props) {
  const { session, workspaceSettings, viewers } = data;
  const addSession = useSessionStore((s) => s.addSession);
  const removeSession = useSessionStore((s) => s.removeSession);
  const activeSessionId = useCanvasStore((s) => s.activeSessionId);
  const setActiveSession = useCanvasStore((s) => s.setActiveSession);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [forking, setForking] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [copied, setCopied] = useState<'win' | 'unix' | null>(null);

  const handleDelete = useCallback(async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await api.sessions.kill(session.id);
      removeSession(session.id);
    } catch (err) {
      console.error('Delete session failed:', err);
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }, [session.id, deleting, removeSession]);

  const handleCopy = useCallback(async (target: 'win' | 'unix') => {
    const cmd = target === 'win'
      ? `wsl tmux attach -t ${session.tmuxSession}`
      : `tmux attach -t ${session.tmuxSession}`;
    await navigator.clipboard.writeText(cmd);
    setCopied(target);
    setTimeout(() => setCopied(null), 2000);
  }, [session.tmuxSession]);

  const handleFork = useCallback(async () => {
    if (forking || !session.claudeSessionId) return;
    setForking(true);
    try {
      const forked = await api.sessions.create({
        name: `${session.name} (fork)`,
        workspacePath: session.workspacePath,
        type: 'claude',
        skipPermissions: workspaceSettings?.skipPermissions,
        claudeArgs: workspaceSettings?.claudeArgs,
        claudeResumeId: session.claudeSessionId,
      });
      addSession(forked);
      setActiveSession(forked.id);
    } catch (err) {
      console.error('Fork session failed:', err);
    } finally {
      setForking(false);
    }
  }, [session, forking, workspaceSettings, addSession, setActiveSession]);

  const isClaude = session.type === 'claude' && !!session.claudeSessionId;
  const Icon = isClaude ? Sparkles : Terminal;
  const isActive = session.status === 'running' || session.status === 'idle';
  const isSelected = activeSessionId === session.id;

  // Other users actively viewing this session (for presence border)
  const activeViewers = viewers.filter(v => v.viewingSessionId === session.id);
  const viewerBorderColor = activeViewers.length > 0 ? activeViewers[0].avatarColor : null;

  return (
    <div
      className="w-full h-full rounded-xl bg-bg-secondary transition-colors flex flex-col"
      style={{
        borderWidth: 2,
        borderStyle: 'solid',
        borderColor: isSelected
          ? '#818cf8'
          : viewerBorderColor || 'var(--border)',
        boxShadow: viewerBorderColor && !isSelected
          ? `0 0 12px ${viewerBorderColor}40`
          : undefined,
      }}
    >
      <NodeResizer
        minWidth={320}
        minHeight={250}
        color="#818cf8"
        handleStyle={{ backgroundColor: '#818cf8', width: 8, height: 8, borderRadius: 4 }}
      />
      {/* Header — draggable area */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <Icon size={14} className="text-text-muted" />
        <span className="text-sm font-medium text-text-primary truncate flex-1">
          {session.name}
          {isActive && (
            <span className={`ml-1.5 text-[10px] font-normal ${isSelected ? 'text-accent' : 'text-text-muted'}`}>
              {isSelected ? '(Active)' : '(Streaming)'}
            </span>
          )}
        </span>

        {/* Action buttons */}
        <div className="flex items-center gap-0.5 nodrag">
          <button
            onClick={() => setShowJoin(!showJoin)}
            className={`p-1 rounded transition-colors ${showJoin ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-text-primary'}`}
            title="Join locally"
          >
            <Monitor size={12} />
          </button>
          {isClaude && (
            <button
              onClick={handleFork}
              disabled={forking}
              className="p-1 rounded text-text-muted hover:text-text-primary transition-colors disabled:opacity-50"
              title="Fork conversation"
            >
              <GitFork size={12} />
            </button>
          )}
          {!confirmDelete ? (
            <button
              onClick={() => setConfirmDelete(true)}
              className="p-1 rounded text-text-muted hover:text-red-400 transition-colors"
              title="Kill session"
            >
              <Trash2 size={12} />
            </button>
          ) : (
            <div className="flex items-center gap-0.5">
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-1.5 py-0.5 bg-red-500 hover:bg-red-600 text-white rounded text-[10px] transition disabled:opacity-50"
              >
                {deleting ? '...' : 'Kill'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="p-0.5 text-text-muted hover:text-text-primary"
              >
                <X size={10} />
              </button>
            </div>
          )}
        </div>

        <Circle
          size={8}
          fill={statusColors[session.status] || '#71717a'}
          color={statusColors[session.status] || '#71717a'}
        />
      </div>

      {/* Join locally info */}
      {showJoin && (
        <div className="flex flex-col gap-1 px-2 py-1.5 bg-accent/5 border-b border-accent/20 text-[10px] shrink-0 nodrag">
          <div className="flex items-center gap-1">
            <span className="text-text-muted w-12 shrink-0">Win:</span>
            <code className="bg-bg-tertiary px-1 py-0.5 rounded font-mono text-text-primary truncate flex-1">
              wsl tmux attach -t {session.tmuxSession}
            </code>
            <button onClick={() => handleCopy('win')} className="text-accent hover:text-accent-hover shrink-0" title="Copy">
              {copied === 'win' ? <Check size={10} /> : <Copy size={10} />}
            </button>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-text-muted w-12 shrink-0">Unix:</span>
            <code className="bg-bg-tertiary px-1 py-0.5 rounded font-mono text-text-primary truncate flex-1">
              tmux attach -t {session.tmuxSession}
            </code>
            <button onClick={() => handleCopy('unix')} className="text-accent hover:text-accent-hover shrink-0" title="Copy">
              {copied === 'unix' ? <Check size={10} /> : <Copy size={10} />}
            </button>
          </div>
        </div>
      )}

      {/* Terminal preview — nodrag/nowheel/nopan to prevent ReactFlow conflicts */}
      <div
        className="flex-1 bg-[#0a0a0f] rounded-b-xl mx-1 mt-1 overflow-hidden relative min-h-0 nodrag nowheel nopan"
        onClick={() => isActive && setActiveSession(session.id)}
      >
        {isActive ? (
          <TerminalView sessionId={session.id} isSelected={isSelected} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-text-muted text-xs">
            <span className="opacity-50">
              {session.status === 'stopped' ? 'Session stopped' : 'Session inactive'}
            </span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-3 py-1.5 text-xs text-text-muted shrink-0">
        <span className="truncate max-w-[60%]">{session.workspacePath.split(/[/\\]/).pop()}</span>
        {viewers.length > 0 && <UserAvatarStack users={viewers} max={3} />}
      </div>
    </div>
  );
});
