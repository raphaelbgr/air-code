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
  lastSavedAt: string | null;

  setNodes: (nodes: Node<AppNodeData>[]) => void;
  setEdges: (edges: Edge[]) => void;
  setViewport: (viewport: Viewport) => void;
  onNodesChange: (changes: NodeChange<Node<AppNodeData>>[]) => void;

  setActiveSession: (id: string | null) => void;

  setSaveStatus: (s: SaveStatus, savedAt?: string) => void;
  initCanvasFromData: (workspaces: Workspace[], sessions: Session[], savedLayout?: SavedLayout | null) => void;
  mergeCanvasWithData: (workspaces: Workspace[], sessions: Session[]) => void;
}

// Layout constants
const WORKSPACE_PADDING = 40;
const SESSION_WIDTH = 520;
const SESSION_HEIGHT = 370;
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

const WORKSPACE_GAP = 60;

/**
 * Check if two rectangles overlap (with gap).
 */
function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
  gap: number,
): boolean {
  return (
    a.x < b.x + b.w + gap &&
    a.x + a.w + gap > b.x &&
    a.y < b.y + b.h + gap &&
    a.y + a.h + gap > b.y
  );
}

/**
 * Find a position for a new workspace bubble that doesn't overlap any existing ones.
 * Places it to the right of the rightmost existing bubble at the same Y.
 */
function findNonOverlappingPosition(
  node: Node<AppNodeData>,
  existingBubbles: Node<AppNodeData>[],
): { x: number; y: number } {
  if (existingBubbles.length === 0) return node.position;

  const nodeW = (node.style?.width as number) || 400;
  const nodeH = (node.style?.height as number) || 300;

  // Find the rightmost edge across all existing bubbles
  let maxRight = 0;
  for (const n of existingBubbles) {
    const right = n.position.x + ((n.style?.width as number) || 400);
    if (right > maxRight) maxRight = right;
  }

  const candidate = { x: maxRight + WORKSPACE_GAP, y: node.position.y };

  // Verify no overlap (shouldn't happen since we're past the rightmost, but be safe)
  const overlaps = existingBubbles.some((n) =>
    rectsOverlap(
      { x: candidate.x, y: candidate.y, w: nodeW, h: nodeH },
      {
        x: n.position.x,
        y: n.position.y,
        w: (n.style?.width as number) || 400,
        h: (n.style?.height as number) || 300,
      },
      WORKSPACE_GAP,
    ),
  );

  // If still overlapping (e.g. Y overlap), shift Y to top row
  if (overlaps) {
    candidate.y = 50;
  }

  return candidate;
}

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
  lastSavedAt: null,

  setNodes: (nodes) => set({ nodes }),
  setEdges: (edges) => set({ edges }),
  setViewport: (viewport) => set({ viewport }),

  onNodesChange: (changes) => {
    set({ nodes: applyNodeChanges(changes, get().nodes) });
  },

  setActiveSession: (id) => set({ activeSessionId: id }),

  setSaveStatus: (s, savedAt) => set({
    saveStatus: s,
    ...(savedAt ? { lastSavedAt: savedAt } : {}),
  }),

  /**
   * Called once on initial load. If savedLayout is available, merges
   * saved positions/sizes with fresh data. Otherwise computes full grid.
   */
  initCanvasFromData: (workspaces, sessions, savedLayout) => {
    const freshNodes = buildFreshNodes(workspaces, sessions);

    if (savedLayout?.nodes && savedLayout.nodes.length > 0) {
      // Build a lookup from saved layout
      const savedMap = new Map(savedLayout.nodes.map((n) => [n.id, n]));

      const merged: Node<AppNodeData>[] = [];
      for (const node of freshNodes) {
        const saved = savedMap.get(node.id);
        if (saved) {
          merged.push({
            ...node,
            position: saved.position,
            style: saved.style ? { ...node.style, ...saved.style } : node.style,
            parentId: saved.parentId ?? node.parentId,
          });
        } else if (node.type === 'workspaceBubble') {
          // New workspace not in saved layout — place to avoid overlap
          const existingBubbles = merged.filter((n) => n.type === 'workspaceBubble');
          node.position = findNonOverlappingPosition(node, existingBubbles);
          merged.push(node);
        } else {
          merged.push(node);
        }
      }

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

        // For workspace bubbles, also update style when session count changes
        // so the bubble grows/shrinks to fit its sessions
        const isWorkspace = fresh.type === 'workspaceBubble';
        const sessionCountChanged = isWorkspace
          && (existing.data as WorkspaceBubbleData).sessionCount
             !== (fresh.data as WorkspaceBubbleData).sessionCount;

        if (dataChanged || sessionCountChanged) {
          changed = true;
          merged.push({
            ...existing,
            data: fresh.data,
            ...(sessionCountChanged ? { style: fresh.style } : {}),
          });
        } else {
          merged.push(existing);
        }
      } else if (fresh.type === 'workspaceBubble') {
        // New workspace bubble — place to avoid overlap with existing ones
        changed = true;
        const existingBubbles = merged.filter((n) => n.type === 'workspaceBubble');
        fresh.position = findNonOverlappingPosition(fresh, existingBubbles);
        merged.push(fresh);
      } else {
        // New non-workspace node — use computed grid position
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
