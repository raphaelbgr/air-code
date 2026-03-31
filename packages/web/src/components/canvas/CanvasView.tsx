import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  type NodeTypes,
  type OnNodesChange,
  applyNodeChanges,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useCanvasStore, type SavedLayout } from '@/stores/canvas.store';
import { useSessionStore } from '@/stores/session.store';
import { usePresenceStore } from '@/stores/presence.store';
import { api } from '@/lib/api';
import { WorkspaceBubble } from './WorkspaceBubble';
import { SessionNode } from './SessionNode';
import { CanvasToolbar } from './CanvasToolbar';
import { SearchDialog } from './SearchDialog';
import { CreateWorkspaceDialog } from '../dialogs/CreateWorkspaceDialog';
import { CreateSessionDialog } from '../dialogs/CreateSessionDialog';
import { DetectWorkspacesDialog } from '../dialogs/DetectWorkspacesDialog';
import type { AppNodeData, SessionNodeData, Session, Workspace } from '@/types';

const nodeTypes: NodeTypes = {
  workspaceBubble: WorkspaceBubble as unknown as NodeTypes['workspaceBubble'],
  sessionNode: SessionNode as unknown as NodeTypes['sessionNode'],
};

const norm = (p: string) => p.toLowerCase().replace(/\//g, '\\');

interface TabStop {
  type: 'workspace' | 'session';
  nodeId: string;
  sessionId?: string;
}

/**
 * Build tab stops ordered by visual X position (leftmost first).
 * - Workspaces with sessions: only their sessions appear (sorted by createdAt)
 * - Empty workspaces: the workspace bubble itself appears
 * - Orphan sessions: appended at the end (sorted by createdAt)
 * Node positions are read live from the canvas store on each Tab press.
 */
function buildTabStops(
  workspaces: Workspace[],
  sessions: Session[],
  nodes: Node<AppNodeData>[],
): TabStop[] {
  const stops: TabStop[] = [];

  // Get absolute X,Y for each workspace bubble node
  const wsNodesWithPos = workspaces.map((ws) => {
    const node = nodes.find((n) => n.id === `ws-${ws.id}`);
    return { ws, x: node?.position.x ?? Infinity, y: node?.position.y ?? Infinity };
  });
  // Sort by X ascending (leftmost first), then Y ascending (topmost first) as tiebreaker
  wsNodesWithPos.sort((a, b) => a.x - b.x || a.y - b.y);

  const assignedPaths = new Set(
    workspaces.map((w) => w.path).filter(Boolean).map((p) => norm(p!)),
  );

  for (const { ws } of wsNodesWithPos) {
    const wsSessions = sessions
      .filter((s) => ws.path && s.workspacePath && norm(s.workspacePath) === norm(ws.path));

    if (wsSessions.length > 0) {
      // Sort sessions by their visual position inside the container:
      // X ascending (leftmost first), Y ascending (topmost first) as tiebreaker
      const sessionsWithPos = wsSessions.map((s) => {
        const node = nodes.find((n) => n.id === `session-${s.id}`);
        return { s, x: node?.position.x ?? Infinity, y: node?.position.y ?? Infinity };
      });
      sessionsWithPos.sort((a, b) => a.x - b.x || a.y - b.y);

      for (const { s } of sessionsWithPos) {
        stops.push({ type: 'session', nodeId: `session-${s.id}`, sessionId: s.id });
      }
    } else {
      // Empty workspace — add the bubble itself
      stops.push({ type: 'workspace', nodeId: `ws-${ws.id}` });
    }
  }

  // Orphan sessions (no workspace) — sort by visual position
  const orphans = sessions
    .filter((s) => !s.workspacePath || !assignedPaths.has(norm(s.workspacePath)));
  const orphansWithPos = orphans.map((s) => {
    const node = nodes.find((n) => n.id === `session-${s.id}`);
    return { s, x: node?.position.x ?? Infinity, y: node?.position.y ?? Infinity };
  });
  orphansWithPos.sort((a, b) => a.x - b.x || a.y - b.y);
  for (const { s } of orphansWithPos) {
    stops.push({ type: 'session', nodeId: `session-${s.id}`, sessionId: s.id });
  }

  return stops;
}

const ZOOM_SENSITIVITY = 0.002;
const PAN_SENSITIVITY = 1;
const SMOOTH_MS = 120;

export function CanvasView() {
  const { nodes, edges, setNodes, setViewport, initCanvasFromData, mergeCanvasWithData, initialized } = useCanvasStore();
  const showSearch = useCanvasStore((s) => s.showSearch);
  const setShowSearch = useCanvasStore((s) => s.setShowSearch);
  const toggleSearch = useCanvasStore((s) => s.toggleSearch);
  const activeSessionId = useCanvasStore((s) => s.activeSessionId);
  const setActiveSession = useCanvasStore((s) => s.setActiveSession);
  const { sessions, workspaces, fetchAll } = useSessionStore();
  const presenceUsers = usePresenceStore((s) => s.users);
  const reactFlow = useReactFlow();
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false);
  const [showDetectWorkspaces, setShowDetectWorkspaces] = useState(false);
  const [showCreateSession, setShowCreateSession] = useState(false);
  const initDone = useRef(false);
  const lastTabNodeId = useRef<string | null>(null);

  // Fetch data on mount + poll
  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 5000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  // Initial load: fetch saved canvas state, then init
  useEffect(() => {
    if (initDone.current || (workspaces.length === 0 && sessions.length === 0)) return;
    initDone.current = true;

    (async () => {
      let savedLayout: SavedLayout | null = null;
      try {
        const raw = await api.canvas.get();
        // Cast from CanvasState (unknown[] nodes) to SavedLayout
        if (raw?.nodes) {
          savedLayout = raw as unknown as SavedLayout;
        }
      } catch {
        // No saved state — will use computed grid
      }
      initCanvasFromData(workspaces, sessions, savedLayout);
    })();
  }, [workspaces, sessions, initCanvasFromData]);

  // On subsequent polls: merge data (preserves positions)
  useEffect(() => {
    if (!initialized) return;
    mergeCanvasWithData(workspaces, sessions);
  }, [workspaces, sessions, initialized, mergeCanvasWithData]);

  // Inject presence viewers into session nodes
  useEffect(() => {
    if (presenceUsers.length === 0 && nodes.length === 0) return;
    let changed = false;
    const updated = nodes.map((node) => {
      if (node.type !== 'sessionNode') return node;
      const data = node.data as SessionNodeData;
      const viewers = presenceUsers.filter((u) => u.viewingSessionId === data.session.id);
      if (viewers.length !== data.viewers.length) {
        changed = true;
        return { ...node, data: { ...data, viewers } };
      }
      return node;
    });
    if (changed) setNodes(updated);
  }, [presenceUsers, nodes, setNodes]);

  const onNodesChange: OnNodesChange<Node<AppNodeData>> = useCallback(
    (changes) => {
      setNodes(applyNodeChanges(changes, nodes));
    },
    [nodes, setNodes],
  );

  // Unified keyboard handler: Ctrl+K, Escape, Tab/Shift+Tab
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ctrl+K — toggle search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggleSearch();
        return;
      }

      // Escape — close search / deselect active session / clear tab focus
      if (e.key === 'Escape') {
        setShowSearch(false);
        setActiveSession(null);
        lastTabNodeId.current = null;
        return;
      }

      // Tab / Shift+Tab — cycle through tab stops
      if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Don't cycle when search dialog is open (let it handle focus)
        if (useCanvasStore.getState().showSearch) return;

        e.preventDefault();
        e.stopPropagation();

        const store = useCanvasStore.getState();
        const sessionStore = useSessionStore.getState();
        const stops = buildTabStops(sessionStore.workspaces, sessionStore.sessions, store.nodes);
        if (stops.length === 0) return;

        // Find current position by last focused nodeId (works for both workspaces and sessions)
        let currentIdx = -1;
        if (lastTabNodeId.current) {
          currentIdx = stops.findIndex((s) => s.nodeId === lastTabNodeId.current);
        }
        // Fallback: if activeSessionId is set (e.g. from search click), match by that
        if (currentIdx === -1 && store.activeSessionId) {
          currentIdx = stops.findIndex((s) => s.sessionId === store.activeSessionId);
        }

        // Move forward or backward
        const direction = e.shiftKey ? -1 : 1;
        const nextIdx = currentIdx === -1
          ? (direction === 1 ? 0 : stops.length - 1)
          : (currentIdx + direction + stops.length) % stops.length;

        const target = stops[nextIdx];
        lastTabNodeId.current = target.nodeId;

        if (target.type === 'workspace') {
          reactFlow.fitView({ nodes: [{ id: target.nodeId }], duration: 300, padding: 0.3 });
          setActiveSession(null);
        } else {
          reactFlow.fitView({ nodes: [{ id: target.nodeId }], duration: 300, padding: 0.5 });
          setActiveSession(target.sessionId!);
        }
      }
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [toggleSearch, setShowSearch, setActiveSession, reactFlow]);

  // Smooth wheel: pan (scroll) + zoom (Ctrl+scroll)
  // Pan uses setViewport with duration (linear deltas blend well).
  // Zoom uses a rAF lerp loop — a single animation chases the target,
  // avoiding conflicting d3 transitions that cause jitter.
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomTarget = useRef({ x: 0, y: 0, zoom: 1 });
  const zoomRaf = useRef(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const LERP = 0.25;
    const EPS = 0.001;

    const animateZoom = () => {
      const vp = reactFlow.getViewport();
      const t = zoomTarget.current;
      const nx = vp.x + (t.x - vp.x) * LERP;
      const ny = vp.y + (t.y - vp.y) * LERP;
      const nz = vp.zoom + (t.zoom - vp.zoom) * LERP;
      reactFlow.setViewport({ x: nx, y: ny, zoom: nz });

      if (Math.abs(nz - t.zoom) > EPS || Math.abs(nx - t.x) > 0.5 || Math.abs(ny - t.y) > 0.5) {
        zoomRaf.current = requestAnimationFrame(animateZoom);
      } else {
        reactFlow.setViewport(t); // snap to exact target
        zoomRaf.current = 0;
      }
    };

    const handler = (e: WheelEvent) => {
      e.preventDefault();

      if (e.ctrlKey) {
        // Zoom centered on cursor — update target, rAF loop does the smoothing
        const current = zoomRaf.current ? zoomTarget.current : reactFlow.getViewport();
        const delta = -e.deltaY * ZOOM_SENSITIVITY;
        const newZoom = Math.min(2, Math.max(0.1, current.zoom * (1 + delta)));

        const rect = el.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const scale = newZoom / current.zoom;

        zoomTarget.current = {
          x: mouseX - (mouseX - current.x) * scale,
          y: mouseY - (mouseY - current.y) * scale,
          zoom: newZoom,
        };

        if (!zoomRaf.current) {
          zoomRaf.current = requestAnimationFrame(animateZoom);
        }
      } else {
        // Pan — shift+scroll for horizontal
        const vp = reactFlow.getViewport();
        const dx = (e.deltaX || (e.shiftKey ? e.deltaY : 0)) * PAN_SENSITIVITY;
        const dy = (e.shiftKey ? 0 : e.deltaY) * PAN_SENSITIVITY;

        reactFlow.setViewport(
          { x: vp.x - dx, y: vp.y - dy, zoom: vp.zoom },
          { duration: SMOOTH_MS },
        );
      }
    };

    el.addEventListener('wheel', handler, { passive: false });
    return () => {
      el.removeEventListener('wheel', handler);
      if (zoomRaf.current) cancelAnimationFrame(zoomRaf.current);
    };
  }, [reactFlow]);

  return (
    <div ref={containerRef} className="w-full h-full relative">
      <CanvasToolbar
        onCreateWorkspace={() => setShowCreateWorkspace(true)}
        onDetectWorkspaces={() => setShowDetectWorkspaces(true)}
        onCreateSession={() => setShowCreateSession(true)}
      />

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onMoveEnd={(_, viewport) => setViewport(viewport)}
        fitView={!initialized}
        minZoom={0.1}
        maxZoom={2}
        zoomOnScroll={false}
        panOnScroll={false}
        proOptions={{ hideAttribution: true }}
        className="bg-bg-primary"
      >
        <Background gap={20} size={1} color="#1e1e2e" />
        <Controls position="bottom-right" />
        <MiniMap
          position="bottom-left"
          nodeStrokeWidth={3}
          maskColor="rgba(0,0,0,0.6)"
        />
      </ReactFlow>

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 px-3 py-1.5 rounded-full bg-black/40 border border-white/10 backdrop-blur-sm text-[11px] text-white/50 pointer-events-none select-none">
        <span><kbd className="px-1 py-0.5 rounded bg-white/10 text-white/60 font-mono text-[10px]">Scroll</kbd> Pan</span>
        <span><kbd className="px-1 py-0.5 rounded bg-white/10 text-white/60 font-mono text-[10px]">Ctrl+Scroll</kbd> Zoom</span>
        <span><kbd className="px-1 py-0.5 rounded bg-white/10 text-white/60 font-mono text-[10px]">Drag</kbd> Move</span>
        <span><kbd className="px-1 py-0.5 rounded bg-white/10 text-white/60 font-mono text-[10px]">Ctrl+K</kbd> Search</span>
        <span><kbd className="px-1 py-0.5 rounded bg-white/10 text-white/60 font-mono text-[10px]">Tab</kbd> Cycle</span>
        <span><kbd className="px-1 py-0.5 rounded bg-white/10 text-white/60 font-mono text-[10px]">Esc</kbd> Deselect</span>
      </div>

      <SearchDialog open={showSearch} onClose={() => setShowSearch(false)} />

      {showCreateWorkspace && (
        <CreateWorkspaceDialog onClose={() => setShowCreateWorkspace(false)} />
      )}
      {showDetectWorkspaces && (
        <DetectWorkspacesDialog onClose={() => setShowDetectWorkspaces(false)} />
      )}
      {showCreateSession && (
        <CreateSessionDialog onClose={() => setShowCreateSession(false)} />
      )}
    </div>
  );
}
