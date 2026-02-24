import { useEffect, useState } from 'react';
import { Cloud, Loader2, CloudOff, Check } from 'lucide-react';
import { formatRelative } from '@claude-air/shared';
import { useCanvasStore } from '@/stores/canvas.store';

export function SaveStatusIcon() {
  const saveStatus = useCanvasStore((s) => s.saveStatus);
  const lastSavedAt = useCanvasStore((s) => s.lastSavedAt);
  const [, tick] = useState(0);

  // Re-render every 30s so relative time stays fresh ("2m ago" → "3m ago")
  useEffect(() => {
    if (!lastSavedAt) return;
    const interval = setInterval(() => tick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, [lastSavedAt]);

  let icon;
  let label: string;
  switch (saveStatus) {
    case 'saving':
      icon = <Loader2 size={14} className="text-accent animate-spin" />;
      label = 'Saving...';
      break;
    case 'saved':
      icon = <Check size={14} className="text-green-400" />;
      label = 'Saved';
      break;
    case 'error':
      icon = <CloudOff size={14} className="text-red-400" />;
      label = 'Save failed';
      break;
    default:
      icon = <Cloud size={14} className="text-text-muted" />;
      label = lastSavedAt ? formatRelative(lastSavedAt) : 'Not saved yet';
      break;
  }

  return (
    <span className="flex items-center gap-1.5 text-xs text-text-muted" title={label}>
      {icon}
      <span className="hidden sm:inline">
        {saveStatus === 'saving' && 'Saving...'}
        {saveStatus === 'saved' && 'Saved'}
        {saveStatus === 'error' && 'Failed'}
        {saveStatus === 'idle' && lastSavedAt && formatRelative(lastSavedAt)}
        {saveStatus === 'idle' && !lastSavedAt && 'Not synced'}
      </span>
    </span>
  );
}
