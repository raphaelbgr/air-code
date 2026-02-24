import { useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { Workspace, WorkspaceSettings } from '@claude-air/shared';
import { api } from '@/lib/api';

interface Props {
  workspace: Workspace;
  onClose: () => void;
  onSaved: (updated: Workspace) => void;
}

export function WorkspaceSettingsDialog({ workspace, onClose, onSaved }: Props) {
  const [skipPermissions, setSkipPermissions] = useState(workspace.settings?.skipPermissions ?? false);
  const [claudeArgs, setClaudeArgs] = useState(workspace.settings?.claudeArgs ?? '');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const settings: WorkspaceSettings = {
        skipPermissions,
        claudeArgs: claudeArgs.trim() || undefined,
      };
      const updated = await api.workspaces.updateSettings(workspace.id, settings);
      onSaved(updated);
      onClose();
    } catch (err) {
      alert(String(err));
    } finally {
      setLoading(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 flex items-center justify-center bg-black/50" style={{ zIndex: 9999 }}>
      <div className="w-full max-w-md p-6 rounded-2xl bg-bg-secondary border border-border" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text-primary">
            {workspace.name} Settings
          </h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={skipPermissions}
              onChange={(e) => setSkipPermissions(e.target.checked)}
              className="rounded border-border"
            />
            Skip permissions (--dangerously-skip-permissions)
          </label>

          <div>
            <label className="block text-sm text-text-secondary mb-1">
              Extra Claude args
            </label>
            <input
              type="text"
              placeholder='e.g. --model sonnet --allowedTools "Edit,Write"'
              value={claudeArgs}
              onChange={(e) => setClaudeArgs(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-bg-tertiary border border-border text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 rounded-lg bg-accent hover:bg-accent-hover text-white font-medium transition disabled:opacity-50"
          >
            {loading ? 'Saving...' : 'Save Settings'}
          </button>
        </form>
      </div>
    </div>,
    document.body,
  );
}
