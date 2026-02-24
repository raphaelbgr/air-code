import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
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
import { CreateWorkspaceDialog } from '../dialogs/CreateWorkspaceDialog';
import { CreateSessionDialog } from '../dialogs/CreateSessionDialog';
import { DetectWorkspacesDialog } from '../dialogs/DetectWorkspacesDialog';
import type { AppNodeData, SessionNodeData } from '@/types';

const nodeTypes: NodeTypes = {
  workspaceBubble: WorkspaceBubble as unknown as NodeTypes['workspaceBubble'],
  sessionNode: SessionNode as unknown as NodeTypes['sessionNode'],
};

export function CanvasView() {
  const { nodes, edges, setNodes, setViewport, initCanvasFromData, mergeCanvasWithData, initialized } = useCanvasStore();
  const { sessions, workspaces, fetchAll } = useSessionStore();
  const presenceUsers = usePresenceStore((s) => s.users);
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false);
  const [showDetectWorkspaces, setShowDetectWorkspaces] = useState(false);
  const [showCreateSession, setShowCreateSession] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const initDone = useRef(false);

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

  // Cmd+K search shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowSearch((v) => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="w-full h-full relative">
      <CanvasToolbar
        onCreateWorkspace={() => setShowCreateWorkspace(true)}
        onDetectWorkspaces={() => setShowDetectWorkspaces(true)}
        onCreateSession={() => setShowCreateSession(true)}
        onSearch={() => setShowSearch(true)}
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
        panOnScroll
        zoomActivationKeyCode="Control"
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
        <span><kbd className="px-1 py-0.5 rounded bg-white/10 text-white/60 font-mono text-[10px]">Esc</kbd> Deselect</span>
      </div>

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
