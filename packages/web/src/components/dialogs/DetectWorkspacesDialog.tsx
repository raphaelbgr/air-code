import { useEffect, useState, useCallback } from 'react';
import { X, Check, Loader2, FolderSearch } from 'lucide-react';
import { formatDate } from '@claude-air/shared';
import { api } from '@/lib/api';
import { useSessionStore } from '@/stores/session.store';
import type { DetectedWorkspace } from '@/types';

const COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

export function DetectWorkspacesDialog({ onClose }: { onClose: () => void }) {
  const [detected, setDetected] = useState<DetectedWorkspace[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(true);
  const [importing, setImporting] = useState(false);
  const [scanDir, setScanDir] = useState('');
  const fetchWorkspaces = useSessionStore((s) => s.fetchWorkspaces);

  const runDetect = useCallback((dir?: string) => {
    setScanning(true);
    api.workspaces.detect(dir || undefined).then((results) => {
      setDetected(results);
      setSelected(new Set());
      setScanning(false);
    }).catch(() => {
      setScanning(false);
    });
  }, []);

  useEffect(() => {
    runDetect();
  }, [runDetect]);

  const handleScanDir = () => {
    if (scanDir.trim()) {
      runDetect(scanDir.trim());
    }
  };

  const toggleSelect = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const selectAll = () => {
    setSelected(new Set(detected.filter((w) => !w.alreadyImported).map((w) => w.path)));
  };

  const clearAll = () => {
    setSelected(new Set());
  };

  const handleImport = async () => {
    const toImport = detected
      .filter((w) => selected.has(w.path) && !w.alreadyImported)
      .map((w, i) => ({
        path: w.path,
        name: w.name,
        color: COLORS[i % COLORS.length],
      }));

    if (toImport.length === 0) return;

    setImporting(true);
    try {
      await api.workspaces.import(toImport);
      await fetchWorkspaces();
      onClose();
    } catch (err) {
      alert(String(err));
    } finally {
      setImporting(false);
    }
  };

  const importableCount = detected.filter((w) => selected.has(w.path) && !w.alreadyImported).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg p-6 rounded-2xl bg-bg-secondary border border-border">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text-primary">Detect Workspaces</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        <div className="flex gap-2 mb-4">
          <input
            type="text"
            placeholder="Scan folder (e.g. C:\Users\you\git)"
            value={scanDir}
            onChange={(e) => setScanDir(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleScanDir()}
            className="flex-1 px-3 py-2 rounded-lg bg-bg-tertiary border border-border text-text-primary placeholder:text-text-muted text-sm focus:outline-none focus:border-accent"
          />
          <button
            onClick={handleScanDir}
            disabled={!scanDir.trim() || scanning}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-bg-tertiary border border-border hover:border-border-bright text-text-secondary text-sm transition disabled:opacity-50"
          >
            <FolderSearch size={14} />
            Scan
          </button>
        </div>

        {scanning ? (
          <div className="flex items-center justify-center gap-2 py-12 text-text-secondary">
            <Loader2 size={18} className="animate-spin" />
            Scanning{scanDir ? ` ${scanDir}...` : ' Claude projects...'}
          </div>
        ) : detected.length === 0 ? (
          <p className="py-8 text-center text-text-muted">
            No projects found. Try scanning a folder above.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-text-secondary">
                {detected.length} project{detected.length !== 1 ? 's' : ''} found
              </span>
              <div className="flex gap-2 text-xs">
                <button onClick={selectAll} className="text-accent hover:underline">Select all</button>
                <button onClick={clearAll} className="text-text-muted hover:underline">Clear</button>
              </div>
            </div>

            <div className="max-h-80 overflow-y-auto space-y-1 mb-4">
              {detected.map((ws) => (
                <label
                  key={ws.path}
                  className={`flex items-center gap-3 p-2.5 rounded-lg cursor-pointer transition ${
                    ws.alreadyImported
                      ? 'opacity-50 cursor-default'
                      : selected.has(ws.path)
                        ? 'bg-accent/10 border border-accent/30'
                        : 'hover:bg-bg-tertiary border border-transparent'
                  }`}
                >
                  <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                    {ws.alreadyImported ? (
                      <Check size={14} className="text-green-500" />
                    ) : (
                      <input
                        type="checkbox"
                        checked={selected.has(ws.path)}
                        onChange={() => toggleSelect(ws.path)}
                        className="w-4 h-4 rounded border-border accent-accent"
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-text-primary truncate">
                      {ws.name}
                      {ws.alreadyImported && (
                        <span className="ml-2 text-xs text-text-muted">(imported)</span>
                      )}
                    </div>
                    <div className="text-xs text-text-muted truncate">{ws.path}</div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    {ws.sessionCount > 0 && (
                      <div className="text-xs text-text-secondary">
                        {ws.sessionCount} session{ws.sessionCount !== 1 ? 's' : ''}
                      </div>
                    )}
                    {ws.lastActive && (
                      <div className="text-xs text-text-muted">{formatDate(ws.lastActive)}</div>
                    )}
                  </div>
                </label>
              ))}
            </div>

            <button
              onClick={handleImport}
              disabled={importing || importableCount === 0}
              className="w-full py-2 rounded-lg bg-accent hover:bg-accent-hover text-white font-medium transition disabled:opacity-50"
            >
              {importing
                ? 'Importing...'
                : importableCount > 0
                  ? `Import ${importableCount} Workspace${importableCount !== 1 ? 's' : ''}`
                  : 'No workspaces to import'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
