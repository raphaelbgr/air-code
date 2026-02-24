import { Cloud, Loader2, CloudOff, Check } from 'lucide-react';
import { useCanvasStore } from '@/stores/canvas.store';

export function SaveStatusIcon() {
  const saveStatus = useCanvasStore((s) => s.saveStatus);

  let icon;
  let label;
  switch (saveStatus) {
    case 'saving':
      icon = <Loader2 size={14} className="text-accent animate-spin" />;
      label = 'Saving layout...';
      break;
    case 'saved':
      icon = <Check size={14} className="text-green-400" />;
      label = 'Layout saved';
      break;
    case 'error':
      icon = <CloudOff size={14} className="text-red-400" />;
      label = 'Save failed';
      break;
    default:
      icon = <Cloud size={14} className="text-text-muted" />;
      label = 'Layout synced';
      break;
  }

  return <span title={label}>{icon}</span>;
}
