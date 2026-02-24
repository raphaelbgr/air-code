import { create } from 'zustand';
import { applyNodeChanges, type Node, type Edge, type Viewport, type NodeChange } from '@xyflow/react';
import type { AppNodeData, Workspace, Session } from '@/types';

interface CanvasState {
  nodes: Node<AppNodeData>[];
  edges: Edge[];
  viewport: Viewport;
  activeSessionId: string | null;
  panelOpen: boolean;
  panelTabs: string[];

  setNodes: (nodes: Node<AppNodeData>[]) => void;
  setEdges: (edges: Edge[]) => void;
  setViewport: (viewport: Viewport) => void;
  onNodesChange: (changes: NodeChange<Node<AppNodeData>>[]) => void;

  setActiveSession: (id: string | null) => void;
  openPanel: (sessionId: string) => void;
  closePanel: () => void;
  closePanelTab: (sessionId: string) => void;

  buildCanvasFromData: (workspaces: Workspace[], sessions: Session[]) => void;
}

// Layout constants
const WORKSPACE_PADDING = 40;
const SESSION_WIDTH = 320;
const SESSION_HEIGHT = 220;
const SESSIONS_PER_ROW = 3;
const SESSION_GAP = 20;
const WORKSPACE_HEADER = 60;

export const useCanvasStore = create<CanvasState>()((set, get) => ({
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  activeSessionId: null,
  panelOpen: false,
  panelTabs: [],

  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),
  setViewport: (viewport) => set({ viewport }),

  onNodesChange: (changes) => {
    set({ nodes: applyNodeChanges(changes, get().nodes) });
  },

  setActiveSession: (id) => set({ activeSessionId: id }),

  openPanel: (sessionId) => {
    const { panelTabs } = get();
    const newTabs = panelTabs.includes(sessionId)
      ? panelTabs
      : [...panelTabs, sessionId];
    set({ panelOpen: true, panelTabs: newTabs, activeSessionId: sessionId });
  },

  closePanel: () => set({ panelOpen: false }),

  closePanelTab: (sessionId) => {
    const { panelTabs, activeSessionId } = get();
    const newTabs = panelTabs.filter((id) => id !== sessionId);
    const newActive = activeSessionId === sessionId
      ? newTabs[newTabs.length - 1] || null
      : activeSessionId;
    set({
      panelTabs: newTabs,
      activeSessionId: newActive,
      panelOpen: newTabs.length > 0,
    });
  },

  buildCanvasFromData: (workspaces, sessions) => {
    const nodes: Node<AppNodeData>[] = [];
    const norm = (p: string) => p.toLowerCase().replace(/\//g, '\\');

    let workspaceX = 50;
    const workspaceY = 50;

    for (const workspace of workspaces) {
      const wsSessions = sessions.filter((s) => {
        if (!workspace.path || !s.workspacePath) return false;
        return norm(s.workspacePath) === norm(workspace.path);
      });

      const cols = Math.min(wsSessions.length || 1, SESSIONS_PER_ROW);
      const rows = Math.ceil((wsSessions.length || 1) / SESSIONS_PER_ROW);
      const wsWidth = cols * (SESSION_WIDTH + SESSION_GAP) + WORKSPACE_PADDING * 2 - SESSION_GAP;
      const wsHeight = rows * (SESSION_HEIGHT + SESSION_GAP) + WORKSPACE_HEADER + WORKSPACE_PADDING * 2 - SESSION_GAP;

      // Workspace bubble node
      nodes.push({
        id: `ws-${workspace.id}`,
        type: 'workspaceBubble',
        position: { x: workspaceX, y: workspaceY },
        data: {
          type: 'workspace',
          workspace,
          sessionCount: wsSessions.length,
          claudeSessionCount: workspace.claudeSessionCount ?? 0,
          collapsed: false,
        },
        style: { width: Math.max(wsWidth, 400), height: Math.max(wsHeight, 300) },
      });

      // Session nodes inside workspace
      wsSessions.forEach((session, i) => {
        const col = i % SESSIONS_PER_ROW;
        const row = Math.floor(i / SESSIONS_PER_ROW);
        nodes.push({
          id: `session-${session.id}`,
          type: 'sessionNode',
          position: {
            x: WORKSPACE_PADDING + col * (SESSION_WIDTH + SESSION_GAP),
            y: WORKSPACE_HEADER + WORKSPACE_PADDING + row * (SESSION_HEIGHT + SESSION_GAP),
          },
          parentId: `ws-${workspace.id}`,
          expandParent: true,
          data: {
            type: 'session',
            session,
            workspaceId: workspace.id,
            viewers: [],
          },
          style: { width: SESSION_WIDTH, height: SESSION_HEIGHT },
        });
      });

      workspaceX += Math.max(wsWidth, 400) + 60;
    }

    // Sessions without workspace
    const assignedPaths = new Set(
      workspaces.map((w) => w.path).filter(Boolean).map((p) => norm(p!)),
    );
    const orphanSessions = sessions.filter(
      (s) => !s.workspacePath || !assignedPaths.has(norm(s.workspacePath)),
    );
    if (orphanSessions.length > 0) {
      orphanSessions.forEach((session, i) => {
        nodes.push({
          id: `session-${session.id}`,
          type: 'sessionNode',
          position: {
            x: workspaceX + (i % SESSIONS_PER_ROW) * (SESSION_WIDTH + SESSION_GAP),
            y: 50 + Math.floor(i / SESSIONS_PER_ROW) * (SESSION_HEIGHT + SESSION_GAP),
          },
          data: {
            type: 'session',
            session,
            workspaceId: '',
            viewers: [],
          },
          style: { width: SESSION_WIDTH, height: SESSION_HEIGHT },
        });
      });
    }

    set({ nodes, edges: [] });
  },
}));
