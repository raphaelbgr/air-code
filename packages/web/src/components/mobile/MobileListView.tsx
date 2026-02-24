import { useState } from 'react';
import { ChevronDown, ChevronRight, Terminal, Circle, Plus, FolderPlus } from 'lucide-react';
import { useSessionStore } from '@/stores/session.store';
import type { Workspace, Session } from '@/types';

interface MobileListViewProps {
  onSessionTap: (sessionId: string) => void;
  onCreateWorkspace: () => void;
  onCreateSession: () => void;
}

const statusColors: Record<string, string> = {
  running: '#22c55e',
  idle: '#f59e0b',
  stopped: '#71717a',
  error: '#ef4444',
};

export function MobileListView({ onSessionTap, onCreateWorkspace, onCreateSession }: MobileListViewProps) {
  const { sessions, workspaces } = useSessionStore();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="h-full overflow-y-auto bg-bg-primary">
      {/* Actions bar */}
      <div className="sticky top-0 z-10 flex gap-2 p-3 bg-bg-secondary border-b border-border">
        <button
          onClick={onCreateWorkspace}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-bg-tertiary border border-border text-text-primary text-sm"
        >
          <FolderPlus size={14} />
          Workspace
        </button>
        <button
          onClick={onCreateSession}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-accent text-white text-sm"
        >
          <Plus size={14} />
          Session
        </button>
      </div>

      {/* Workspace accordion */}
      {workspaces.map((workspace) => (
        <WorkspaceSection
          key={workspace.id}
          workspace={workspace}
          sessions={sessions}
          expanded={expanded.has(workspace.id)}
          onToggle={() => toggleExpand(workspace.id)}
          onSessionTap={onSessionTap}
        />
      ))}

      {/* Orphan sessions (no workspace) */}
      {workspaces.length === 0 && sessions.length > 0 && (
        <div className="p-3">
          <div className="text-xs text-text-muted uppercase tracking-wider mb-2">Sessions</div>
          {sessions.map((session) => (
            <SessionRow key={session.id} session={session} onTap={() => onSessionTap(session.id)} />
          ))}
        </div>
      )}

      {workspaces.length === 0 && sessions.length === 0 && (
        <div className="flex flex-col items-center justify-center h-64 text-text-muted">
          <Terminal size={32} className="mb-3 opacity-50" />
          <p className="text-sm">No sessions yet</p>
          <p className="text-xs mt-1">Create a workspace to get started</p>
        </div>
      )}
    </div>
  );
}

function WorkspaceSection({
  workspace,
  sessions,
  expanded,
  onToggle,
  onSessionTap,
}: {
  workspace: Workspace;
  sessions: Session[];
  expanded: boolean;
  onToggle: () => void;
  onSessionTap: (id: string) => void;
}) {
  return (
    <div className="border-b border-border">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-secondary transition"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: workspace.color }} />
        <span className="text-sm font-medium text-text-primary flex-1 text-left">{workspace.name}</span>
        <span className="text-xs text-text-muted">{sessions.length}</span>
      </button>

      {expanded && (
        <div className="pb-2 px-2">
          {sessions.map((session) => (
            <SessionRow key={session.id} session={session} onTap={() => onSessionTap(session.id)} />
          ))}
          {sessions.length === 0 && (
            <div className="text-xs text-text-muted text-center py-4">No sessions</div>
          )}
        </div>
      )}
    </div>
  );
}

function SessionRow({ session, onTap }: { session: Session; onTap: () => void }) {
  return (
    <button
      onClick={onTap}
      className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg hover:bg-bg-tertiary transition text-left"
    >
      <Terminal size={14} className="text-text-muted shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text-primary truncate">{session.name}</div>
        <div className="text-xs text-text-muted truncate">{session.workspacePath}</div>
      </div>
      <Circle size={8} fill={statusColors[session.status] || '#71717a'} color={statusColors[session.status] || '#71717a'} />
    </button>
  );
}
