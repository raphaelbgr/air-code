import { useEffect, useState, useCallback } from 'react';
import { X, Check, Loader2, Folder, FolderPlus, ChevronRight, Home, HardDrive } from 'lucide-react';
import { formatDate } from '@claude-air/shared';
import type { BrowseResult, BrowseItem } from '@claude-air/shared';
import { api } from '@/lib/api';
import { useSessionStore } from '@/stores/session.store';
import type { DetectedWorkspace } from '@/types';

const COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

export function DetectWorkspacesDialog({ onClose }: { onClose: () => void }) {
  const [detected, setDetected] = useState<DetectedWorkspace[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(true);
  const [importing, setImporting] = useState(false);
  const fetchWorkspaces = useSessionStore((s) => s.fetchWorkspaces);

  // Folder browser state
  const [browseResult, setBrowseResult] = useState<BrowseResult | null>(null);
  const [browsing, setBrowsing] = useState(true);
  const [browseError, setBrowseError] = useState('');
  const [addingPath, setAddingPath] = useState(false);

  const runDetect = useCallback(() => {
    setScanning(true);
    api.workspaces.detect().then((results) => {
      setDetected(results);
      setSelected(new Set());
      setScanning(false);
    }).catch(() => {
      setScanning(false);
    });
  }, []);

  const browse = useCallback((path?: string) => {
    setBrowsing(true);
    setBrowseError('');
    api.workspaces.browse(path).then((result) => {
      setBrowseResult(result);
      setBrowsing(false);
    }).catch((err) => {
      setBrowseError(String(err));
      setBrowsing(false);
    });
  }, []);

  useEffect(() => {
    runDetect();
    browse();
  }, [runDetect, browse]);

  const handleAddWorkspace = async () => {
    if (!browseResult) return;
    setAddingPath(true);
    try {
      const name = browseResult.path.split(/[\\/]/).filter(Boolean).pop() || 'Workspace';
      await api.workspaces.import([{
        path: browseResult.path,
        name,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
      }]);
      await fetchWorkspaces();
      // Re-detect to update "already imported" flags
      runDetect();
    } catch (err) {
      setBrowseError(String(err));
    } finally {
      setAddingPath(false);
    }
  };

  // Build breadcrumb segments from the current browse path
  const isDrivesView = browseResult?.path === '__drives__';
  const breadcrumbs = browseResult && !isDrivesView ? buildBreadcrumbs(browseResult.path) : [];

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
      setBrowseError(String(err));
    } finally {
      setImporting(false);
    }
  };

  const importableCount = detected.filter((w) => selected.has(w.path) && !w.alreadyImported).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg p-6 rounded-2xl bg-bg-secondary border border-border max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text-primary">Add Workspace</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        {/* ── Folder Browser ── */}
        <div className="mb-4">
          <div className="text-xs font-medium text-text-secondary mb-2 uppercase tracking-wider">Browse Folders</div>

          {/* Breadcrumb bar */}
          <div className="flex items-center gap-0.5 px-2 py-1.5 mb-2 rounded-lg bg-bg-tertiary border border-border overflow-x-auto text-sm scrollbar-thin">
            <button
              onClick={() => browse('__drives__')}
              className="flex-shrink-0 p-0.5 rounded hover:bg-bg-secondary text-text-muted hover:text-text-primary transition"
              title="This PC"
            >
              <HardDrive size={14} />
            </button>
            <button
              onClick={() => browse()}
              className="flex-shrink-0 p-0.5 rounded hover:bg-bg-secondary text-text-muted hover:text-text-primary transition"
              title="Home"
            >
              <Home size={14} />
            </button>
            {isDrivesView ? (
              <span className="flex items-center gap-0.5 flex-shrink-0">
                <ChevronRight size={12} className="text-text-muted" />
                <span className="px-1 py-0.5 text-text-primary font-medium">This PC</span>
              </span>
            ) : breadcrumbs.map((seg, i) => (
              <span key={seg.path} className="flex items-center gap-0.5 flex-shrink-0">
                <ChevronRight size={12} className="text-text-muted" />
                <button
                  onClick={() => browse(seg.path)}
                  className={`px-1 py-0.5 rounded hover:bg-bg-secondary transition truncate max-w-[120px] ${
                    i === breadcrumbs.length - 1
                      ? 'text-text-primary font-medium'
                      : 'text-text-muted hover:text-text-primary'
                  }`}
                >
                  {seg.label}
                </button>
              </span>
            ))}
          </div>

          {/* Folder list */}
          <div className="max-h-48 overflow-y-auto rounded-lg border border-border bg-bg-tertiary">
            {browsing ? (
              <div className="flex items-center justify-center gap-2 py-6 text-text-secondary">
                <Loader2 size={16} className="animate-spin" />
                Loading...
              </div>
            ) : browseError ? (
              <div className="py-4 px-3 text-sm text-red-400 text-center">{browseError}</div>
            ) : browseResult && browseResult.items.length === 0 ? (
              <div className="py-4 text-sm text-text-muted text-center">No subdirectories</div>
            ) : browseResult ? (
              browseResult.items.map((item: BrowseItem) => (
                <button
                  key={item.name}
                  onClick={() => {
                    if (isDrivesView) {
                      // Drive entry: navigate to drive root (e.g. "C:\")
                      browse(item.name + '\\');
                    } else {
                      browse(browseResult.path + (browseResult.path.endsWith('\\') || browseResult.path.endsWith('/') ? '' : '\\') + item.name);
                    }
                  }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-left hover:bg-bg-secondary transition text-sm"
                >
                  {isDrivesView ? (
                    <HardDrive size={14} className="text-accent flex-shrink-0" />
                  ) : (
                    <Folder size={14} className="text-accent flex-shrink-0" />
                  )}
                  <span className="text-text-primary truncate">{item.name}</span>
                  {item.description && (
                    <span className="text-text-muted text-xs ml-auto flex-shrink-0">{item.description}</span>
                  )}
                </button>
              ))
            ) : null}
          </div>

          {/* Add as Workspace button */}
          {browseResult && !browsing && !isDrivesView && (
            <button
              onClick={handleAddWorkspace}
              disabled={addingPath}
              className="flex items-center justify-center gap-2 w-full mt-2 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white font-medium text-sm transition disabled:opacity-50"
            >
              <FolderPlus size={14} />
              {addingPath ? 'Adding...' : `Add "${breadcrumbs.at(-1)?.label || 'folder'}" as Workspace`}
            </button>
          )}
        </div>

        {/* ── Detected Claude Projects ── */}
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="text-xs font-medium text-text-secondary mb-2 uppercase tracking-wider">Claude Projects</div>

          {scanning ? (
            <div className="flex items-center justify-center gap-2 py-8 text-text-secondary">
              <Loader2 size={18} className="animate-spin" />
              Scanning Claude projects...
            </div>
          ) : detected.length === 0 ? (
            <p className="py-4 text-center text-text-muted text-sm">
              No Claude projects found.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-text-secondary">
                  {detected.length} project{detected.length !== 1 ? 's' : ''} found
                </span>
                <div className="flex gap-2 text-xs">
                  <button onClick={selectAll} className="text-accent hover:underline">Select all</button>
                  <button onClick={clearAll} className="text-text-muted hover:underline">Clear</button>
                </div>
              </div>

              <div className="max-h-52 overflow-y-auto space-y-1 mb-3">
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
    </div>
  );
}

/** Build clickable breadcrumb segments from a path like C:\Users\rbgnr\git */
function buildBreadcrumbs(fullPath: string): { label: string; path: string }[] {
  // Handle Windows paths (C:\foo\bar) and Unix paths (/foo/bar)
  const sep = fullPath.includes('\\') ? '\\' : '/';
  const parts = fullPath.split(sep).filter(Boolean);

  const segments: { label: string; path: string }[] = [];

  if (sep === '\\' && parts.length > 0) {
    // Windows: first part is drive like "C:"
    let accumulated = parts[0] + '\\';
    segments.push({ label: parts[0], path: accumulated });
    for (let i = 1; i < parts.length; i++) {
      accumulated += parts[i] + (i < parts.length - 1 ? '\\' : '');
      segments.push({ label: parts[i], path: accumulated });
    }
  } else {
    // Unix
    let accumulated = '/';
    for (let i = 0; i < parts.length; i++) {
      accumulated += parts[i] + (i < parts.length - 1 ? '/' : '');
      segments.push({ label: parts[i], path: accumulated });
    }
  }

  return segments;
}
