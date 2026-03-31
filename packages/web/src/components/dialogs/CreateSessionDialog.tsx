import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { api } from '@/lib/api';
import { useSessionStore } from '@/stores/session.store';

export function CreateSessionDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [workspacePath, setWorkspacePath] = useState('');
  const [skipPermissions, setSkipPermissions] = useState(false);
  const [loading, setLoading] = useState(false);
  const addSession = useSessionStore((s) => s.addSession);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const session = await api.sessions.create({ name, workspacePath, skipPermissions });
      addSession(session);
      onClose();
    } catch (err) {
      alert(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md p-6 rounded-2xl bg-bg-secondary border border-border">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text-primary">New Session</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="text"
            placeholder="Session name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-bg-tertiary border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            required
            autoFocus
          />
          <input
            type="text"
            placeholder="Workspace path (e.g. /home/user/project)"
            value={workspacePath}
            onChange={(e) => setWorkspacePath(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-bg-tertiary border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            required
          />
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={skipPermissions}
              onChange={(e) => setSkipPermissions(e.target.checked)}
              className="rounded border-border"
            />
            Skip permissions (--dangerously-skip-permissions)
          </label>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 rounded-lg bg-accent hover:bg-accent-hover text-white font-medium transition disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create Session'}
          </button>
        </form>
      </div>
    </div>
  );
}
