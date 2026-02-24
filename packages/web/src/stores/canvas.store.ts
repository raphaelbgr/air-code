import { create } from 'zustand';
import { applyNodeChanges, type Node, type Edge, type Viewport, type NodeChange } from '@xyflow/react';
import type { AppNodeData, SessionNodeData, WorkspaceBubbleData, Workspace, Session } from '@/types';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface CanvasState {
  nodes: Node<AppNodeData>[];
  edges: Edge[];
  viewport: Viewport;
  activeSessionId: string | null;
  initialized: boolean;
  saveStatus: SaveStatus;

  setNodes: (nodes: Node<AppNodeData>[]) => void;
  setEdges: (edges: Edge[]) => void;
  setViewport: (viewport: Viewport) => void;
  onNodesChange: (changes: NodeChange<Node<AppNodeData>>[]) => void;

  setActiveSession: (id: string | null) => void;

  setSaveStatus: (s: SaveStatus) => void;
  initCanvasFromData: (workspaces: Workspace[], sessions: Session[], savedLayout?: SavedLayout | null) => void;
  mergeCanvasWithData: (workspaces: Workspace[], sessions: Session[]) => void;
}

// Layout constants
const WORKSPACE_PADDING = 40;
const SESSION_WIDTH = 520;
const SESSION_HEIGHT = 420;
const SESSIONS_PER_ROW = 3;
const SESSION_GAP = 20;
const WORKSPACE_HEADER = 60;

/** Layout-only node shape saved to the server */
export interface SavedNodeLayout {
  id: string;
  type?: string;
  position: { x: number; y: number };
  style?: Record<string, unknown>;
  parentId?: string;
}

export interface SavedLayout {
  nodes?: SavedNodeLayout[];
  edges?: Edge[];
  viewport?: Viewport;
}

const norm = (p: string) => p.toLowerCase().replace(/\//g, '\\');

/**
 * Pure function: compute fresh nodes from workspace + session data.
 * Returns the full grid layout (positions + sizes) without touching store.
 */
function buildFreshNodes(workspaces: Workspace[], sessions: Session[]): Node<AppNodeData>[] {
  const nodes: Node<AppNodeData>[] = [];

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
          workspaceSettings: workspace.settings,
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

  return nodes;
}

export const useCanvasStore = create<CanvasState>()((set, get) => ({
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  activeSessionId: null,
  initialized: false,
  saveStatus: 'idle' as SaveStatus,

  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),
  setViewport: (viewport) => set({ viewport }),

  onNodesChange: (changes) => {
    set({ nodes: applyNodeChanges(changes, get().nodes) });
  },

  setActiveSession: (id) => set({ activeSessionId: id }),

  setSaveStatus: (s) => set({ saveStatus: s }),

  /**
   * Called once on initial load. If savedLayout is available, merges
   * saved positions/sizes with fresh data. Otherwise computes full grid.
   */
  initCanvasFromData: (workspaces, sessions, savedLayout) => {
    const freshNodes = buildFreshNodes(workspaces, sessions);

    if (savedLayout?.nodes && savedLayout.nodes.length > 0) {
      // Build a lookup from saved layout
      const savedMap = new Map(savedLayout.nodes.map((n) => [n.id, n]));

      const merged = freshNodes.map((node) => {
        const saved = savedMap.get(node.id);
        if (saved) {
          return {
            ...node,
            position: saved.position,
            style: saved.style ? { ...node.style, ...saved.style } : node.style,
            parentId: saved.parentId ?? node.parentId,
          };
        }
        // New node not in saved layout — keep computed grid position
        return node;
      });

      set({
        nodes: merged,
        edges: savedLayout.edges ?? [],
        viewport: savedLayout.viewport ?? { x: 0, y: 0, zoom: 1 },
        initialized: true,
      });
    } else {
      set({ nodes: freshNodes, edges: [], initialized: true });
    }
  },

  /**
   * Called on 5s polls. Preserves user positions/sizes.
   * Only updates node data (session status, viewers, metadata).
   * Adds new nodes, removes deleted ones.
   */
  mergeCanvasWithData: (workspaces, sessions) => {
    const { nodes: currentNodes } = get();
    const freshNodes = buildFreshNodes(workspaces, sessions);
    const freshMap = new Map(freshNodes.map((n) => [n.id, n]));
    const currentMap = new Map(currentNodes.map((n) => [n.id, n]));

    let changed = false;
    const merged: Node<AppNodeData>[] = [];

    // Update existing + add new
    for (const fresh of freshNodes) {
      const existing = currentMap.get(fresh.id);
      if (existing) {
        // Keep position + style (user may have resized/moved)
        // Update data payload (status, viewers, metadata)
        const dataChanged = JSON.stringify(existing.data) !== JSON.stringify(fresh.data);
        if (dataChanged) {
          changed = true;
          merged.push({
            ...existing,
            data: fresh.data,
          });
        } else {
          merged.push(existing);
        }
      } else {
        // New node — use computed grid position
        changed = true;
        merged.push(fresh);
      }
    }

    // Check for removed nodes
    if (currentNodes.length !== merged.length) {
      changed = true;
    }

    if (changed) {
      set({ nodes: merged });
    }
  },
}));
