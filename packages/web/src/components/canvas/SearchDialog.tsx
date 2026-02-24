import { useState, useEffect, useRef, useMemo } from 'react';
import { Search, Terminal, Folder } from 'lucide-react';
import { useReactFlow } from '@xyflow/react';
import { useSessionStore } from '@/stores/session.store';

interface SearchDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SearchDialog({ open, onClose }: SearchDialogProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const sessions = useSessionStore((s) => s.sessions);
  const workspaces = useSessionStore((s) => s.workspaces);
  const reactFlow = useReactFlow();

  useEffect(() => {
    if (open) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const results = useMemo(() => {
    if (!query.trim()) return { sessions: sessions.slice(0, 5), workspaces: workspaces.slice(0, 3) };
    const q = query.toLowerCase();
    return {
      sessions: sessions.filter((s) =>
        s.name.toLowerCase().includes(q) || s.workspacePath.toLowerCase().includes(q),
      ),
      workspaces: workspaces.filter((w) =>
        w.name.toLowerCase().includes(q) || w.description?.toLowerCase().includes(q),
      ),
    };
  }, [query, sessions, workspaces]);

  if (!open) return null;

  const handleSessionClick = (sessionId: string) => {
    const nodeId = `session-${sessionId}`;
    reactFlow.fitView({ nodes: [{ id: nodeId }], duration: 300, padding: 0.5 });
    onClose();
  };

  const handleWorkspaceClick = (workspaceId: string) => {
    const nodeId = `ws-${workspaceId}`;
    reactFlow.fitView({ nodes: [{ id: nodeId }], duration: 300, padding: 0.3 });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/50" onClick={onClose}>
      <div className="w-full max-w-lg bg-bg-secondary border border-border rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search size={16} className="text-text-muted" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sessions and workspaces..."
            className="flex-1 bg-transparent text-text-primary placeholder:text-text-muted text-sm focus:outline-none"
          />
          <kbd className="text-xs text-text-muted bg-bg-tertiary px-1.5 py-0.5 rounded">esc</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto p-2">
          {results.workspaces.length > 0 && (
            <div className="mb-2">
              <div className="text-xs text-text-muted px-2 py-1 uppercase tracking-wider">Workspaces</div>
              {results.workspaces.map((w) => (
                <button
                  key={w.id}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-bg-tertiary text-left transition"
                  onClick={() => handleWorkspaceClick(w.id)}
                >
                  <Folder size={14} style={{ color: w.color }} />
                  <div>
                    <div className="text-sm text-text-primary">{w.name}</div>
                    {w.description && <div className="text-xs text-text-muted">{w.description}</div>}
                  </div>
                </button>
              ))}
            </div>
          )}

          {results.sessions.length > 0 && (
            <div>
              <div className="text-xs text-text-muted px-2 py-1 uppercase tracking-wider">Sessions</div>
              {results.sessions.map((s) => (
                <button
                  key={s.id}
                  className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-bg-tertiary text-left transition"
                  onClick={() => handleSessionClick(s.id)}
                >
                  <Terminal size={14} className="text-text-muted" />
                  <div>
                    <div className="text-sm text-text-primary">{s.name}</div>
                    <div className="text-xs text-text-muted">{s.workspacePath}</div>
                  </div>
                  <span className={`ml-auto text-xs px-1.5 py-0.5 rounded ${
                    s.status === 'running' ? 'bg-success/20 text-success' :
                    s.status === 'error' ? 'bg-error/20 text-error' :
                    'bg-bg-tertiary text-text-muted'
                  }`}>
                    {s.status}
                  </span>
                </button>
              ))}
            </div>
          )}

          {results.sessions.length === 0 && results.workspaces.length === 0 && query && (
            <div className="text-center text-text-muted text-sm py-8">No results found</div>
          )}
        </div>
      </div>
    </div>
  );
}
