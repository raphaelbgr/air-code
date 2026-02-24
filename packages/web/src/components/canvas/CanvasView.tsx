import { useCallback, useEffect, useState } from 'react';
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

import { useCanvasStore } from '@/stores/canvas.store';
import { useSessionStore } from '@/stores/session.store';
import { usePresenceStore } from '@/stores/presence.store';
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
  const { nodes, edges, setNodes, setViewport, buildCanvasFromData } = useCanvasStore();
  const { sessions, workspaces, fetchAll } = useSessionStore();
  const presenceUsers = usePresenceStore((s) => s.users);
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false);
  const [showDetectWorkspaces, setShowDetectWorkspaces] = useState(false);
  const [showCreateSession, setShowCreateSession] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  // Fetch data on mount
  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 5000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  // Build canvas when data changes
  useEffect(() => {
    buildCanvasFromData(workspaces, sessions);
  }, [workspaces, sessions, buildCanvasFromData]);

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
        fitView
        minZoom={0.1}
        maxZoom={2}
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
