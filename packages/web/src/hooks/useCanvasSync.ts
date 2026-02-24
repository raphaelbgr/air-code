import { useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { useCanvasStore, type SavedNodeLayout } from '@/stores/canvas.store';

/**
 * Auto-save canvas layout every 15 seconds.
 * Only saves layout metadata (position, size) — not full node data.
 * Tracks save status for the cloud icon indicator.
 */
export function useCanvasSync() {
  const initialized = useCanvasStore((s) => s.initialized);
  const setSaveStatus = useCanvasStore((s) => s.setSaveStatus);
  const lastSavedRef = useRef<string>('');

  useEffect(() => {
    if (!initialized) return;

    const interval = setInterval(async () => {
      const { nodes, edges, viewport } = useCanvasStore.getState();

      // Strip data from nodes — only save layout metadata
      const layoutNodes: SavedNodeLayout[] = nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        style: n.style as Record<string, unknown> | undefined,
        parentId: n.parentId,
      }));

      const state = { nodes: layoutNodes, edges, viewport };
      const serialized = JSON.stringify(state);

      if (serialized === lastSavedRef.current) return;

      setSaveStatus('saving');
      try {
        await api.canvas.save(state);
        lastSavedRef.current = serialized;
        setSaveStatus('saved');
        setTimeout(() => {
          // Only reset to idle if still 'saved' (not overridden by a new save)
          if (useCanvasStore.getState().saveStatus === 'saved') {
            setSaveStatus('idle');
          }
        }, 3000);
      } catch {
        setSaveStatus('error');
      }
    }, 15000);

    return () => clearInterval(interval);
  }, [initialized, setSaveStatus]);
}
