import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, MessageSquare, Loader2, GitBranch, HardDrive, Copy, Check } from 'lucide-react';
import type { Workspace, ClaudeSession, Session } from '@claude-air/shared';
import { formatRelative } from '@claude-air/shared';
import { api } from '@/lib/api';

interface Props {
  workspace: Workspace;
  onClose: () => void;
  onCreated: (session: Session) => void;
  backend?: 'pty';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function ClaudeLauncherDialog({ workspace, onClose, onCreated, backend }: Props) {
  const [claudeSessions, setClaudeSessions] = useState<ClaudeSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const buildResumeCmd = useCallback((sessionId: string) => {
    let cmd = `claude --resume ${sessionId}`;
    if (workspace.settings?.skipPermissions) cmd += ' --dangerously-skip-permissions';
    if (workspace.settings?.claudeArgs) cmd += ` ${workspace.settings.claudeArgs}`;
    return cmd;
  }, [workspace.settings]);

  const handleCopy = useCallback(async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(buildResumeCmd(sessionId));
    setCopiedId(sessionId);
    setTimeout(() => setCopiedId(null), 2000);
  }, [buildResumeCmd]);

  useEffect(() => {
    api.workspaces.claudeSessions(workspace.id)
      .then(setClaudeSessions)
      .catch(() => setClaudeSessions([]))
      .finally(() => setLoading(false));
  }, [workspace.id]);

  const createSession = useCallback(async (resumeId?: string) => {
    if (!workspace.path || creating) return;
    setCreating(true);
    try {
      const suffix = backend === 'pty' ? ' (claude-ps)' : '';
      const session = await api.sessions.create({
        name: workspace.name + suffix,
        workspacePath: workspace.path,
        type: 'claude',
        backend,
        skipPermissions: workspace.settings?.skipPermissions,
        claudeArgs: workspace.settings?.claudeArgs,
        claudeResumeId: resumeId,
      });
      onCreated(session);
      onClose();
    } catch (err) {
      console.error('Failed to create Claude session:', err);
    } finally {
      setCreating(false);
    }
  }, [workspace, creating, onCreated, onClose]);

  // Render via portal so it appears above all ReactFlow nodes
  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/50"
      style={{ zIndex: 9999 }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-bg-secondary border border-border overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-text-primary">
            Launch Claude Code
            <span className="ml-1.5 text-xs font-normal text-text-muted">
              {backend === 'pty' ? '(PowerShell)' : '(WSL/tmux)'}
            </span>
          </h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        {/* New Conversation button */}
        <div className="px-4 pt-4 pb-2">
          <button
            onClick={() => createSession()}
            disabled={creating}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-accent/10 hover:bg-accent/20 border border-accent/30 transition-colors disabled:opacity-50"
          >
            <Plus size={18} className="text-accent" />
            <div className="text-left">
              <div className="text-sm font-medium text-text-primary">New Conversation</div>
              <div className="text-xs text-text-muted">Start fresh</div>
            </div>
          </button>
        </div>

        {/* Resume Previous */}
        <div className="px-4 pb-4">
          {loading ? (
            <div className="flex items-center justify-center py-6 text-text-muted">
              <Loader2 size={16} className="animate-spin mr-2" />
              <span className="text-sm">Loading conversations...</span>
            </div>
          ) : claudeSessions.length > 0 ? (
            <>
              <div className="text-xs text-text-muted uppercase tracking-wider px-1 py-2">
                Resume Previous ({claudeSessions.length})
              </div>
              <div
                className="max-h-64 overflow-y-auto space-y-1"
                onWheel={(e) => e.stopPropagation()}
              >
                {claudeSessions.map((cs) => (
                  <button
                    key={cs.sessionId}
                    onClick={() => createSession(cs.sessionId)}
                    disabled={creating}
                    className="w-full flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-bg-tertiary transition-colors text-left disabled:opacity-50"
                  >
                    <MessageSquare size={14} className="text-text-muted mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-text-primary truncate">{cs.summary}</div>
                      <div className="flex items-center gap-1.5 text-xs text-text-muted flex-wrap">
                        <span>{cs.messageCount} message{cs.messageCount !== 1 ? 's' : ''}</span>
                        <span className="opacity-40">·</span>
                        <span>{formatRelative(cs.lastActive)}</span>
                        {cs.gitBranch && (
                          <>
                            <span className="opacity-40">·</span>
                            <span className="inline-flex items-center gap-0.5">
                              <GitBranch size={10} />
                              {cs.gitBranch}
                            </span>
                          </>
                        )}
                        {cs.diskSize != null && (
                          <>
                            <span className="opacity-40">·</span>
                            <span className="inline-flex items-center gap-0.5">
                              <HardDrive size={10} />
                              {formatSize(cs.diskSize)}
                            </span>
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-1 mt-0.5">
                        <code className="text-[10px] font-mono text-text-muted/60 truncate">{cs.sessionId}</code>
                        <span
                          role="button"
                          onClick={(e) => handleCopy(e, cs.sessionId)}
                          className="shrink-0 p-0.5 rounded hover:bg-bg-secondary text-text-muted/50 hover:text-text-muted transition-colors"
                          title={`Copy: ${buildResumeCmd(cs.sessionId)}`}
                        >
                          {copiedId === cs.sessionId ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
                        </span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
