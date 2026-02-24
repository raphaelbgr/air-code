import { useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { useCanvasStore } from '@/stores/canvas.store';
import type { CanvasState } from '@/types';

/**
 * Periodically save canvas layout to the server.
 * Debounced: saves at most every 5 seconds on changes.
 */
export function useCanvasSync() {
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const viewport = useCanvasStore((s) => s.viewport);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef<string>('');

  useEffect(() => {
    const state: CanvasState = { nodes, edges, viewport };
    const serialized = JSON.stringify(state);

    // Skip if nothing changed
    if (serialized === lastSavedRef.current) return;

    // Debounce save
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        await api.canvas.save(state);
        lastSavedRef.current = serialized;
      } catch {
        // Silently ignore save failures
      }
    }, 5000);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [nodes, edges, viewport]);
}
