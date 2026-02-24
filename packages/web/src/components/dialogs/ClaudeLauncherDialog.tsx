import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, MessageSquare, Loader2 } from 'lucide-react';
import type { Workspace, ClaudeSession, Session } from '@claude-air/shared';
import { api } from '@/lib/api';

interface Props {
  workspace: Workspace;
  onClose: () => void;
  onCreated: (session: Session) => void;
}

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = Date.now();
  const diff = now - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

export function ClaudeLauncherDialog({ workspace, onClose, onCreated }: Props) {
  const [claudeSessions, setClaudeSessions] = useState<ClaudeSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

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
      const session = await api.sessions.create({
        name: workspace.name,
        workspacePath: workspace.path,
        type: 'claude',
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
          <h2 className="text-base font-semibold text-text-primary">Launch Claude Code</h2>
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
                Resume Previous
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
                      <div className="text-xs text-text-muted">
                        {cs.messageCount} message{cs.messageCount !== 1 ? 's' : ''} · {timeAgo(cs.lastActive)}
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
