import { Plus, FolderPlus, FolderSearch, Search, Bot } from 'lucide-react';
import { useAgentStore } from '@/stores/agent.store';

interface CanvasToolbarProps {
  onCreateWorkspace: () => void;
  onDetectWorkspaces: () => void;
  onCreateSession: () => void;
  onSearch: () => void;
}

export function CanvasToolbar({ onCreateWorkspace, onDetectWorkspaces, onCreateSession, onSearch }: CanvasToolbarProps) {
  const toggleAgent = useAgentStore((s) => s.togglePanel);

  return (
    <div className="absolute top-4 left-4 z-10 flex gap-2">
      <button
        onClick={onCreateWorkspace}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-elevated border border-border hover:border-border-bright text-text-primary text-sm transition"
      >
        <FolderPlus size={14} />
        Workspace
      </button>
      <button
        onClick={onDetectWorkspaces}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-elevated border border-border hover:border-border-bright text-text-primary text-sm transition"
      >
        <FolderSearch size={14} />
        Detect
      </button>
      <button
        onClick={onCreateSession}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-elevated border border-border hover:border-border-bright text-text-primary text-sm transition"
      >
        <Plus size={14} />
        Session
      </button>
      <button
        onClick={onSearch}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-elevated border border-border hover:border-border-bright text-text-secondary text-sm transition"
        title="Cmd+K"
      >
        <Search size={14} />
      </button>
      <button
        onClick={toggleAgent}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/20 border border-accent/30 hover:bg-accent/30 text-accent text-sm transition"
      >
        <Bot size={14} />
        Agent
      </button>
    </div>
  );
}
