export type {
  Session,
  SessionType,
  Workspace,
  DetectedWorkspace,
  ClaudeSession,
  User,
  CanvasState,
  PresenceUser,
  AgentMessage,
  AgentToolCall,
  ApiResponse,
} from '@claude-air/shared';

// ReactFlow node data types - must satisfy Record<string, unknown>
export type WorkspaceBubbleData = {
  type: 'workspace';
  workspace: import('@claude-air/shared').Workspace;
  sessionCount: number;
  claudeSessionCount: number;
  collapsed: boolean;
  [key: string]: unknown;
};

export type SessionNodeData = {
  type: 'session';
  session: import('@claude-air/shared').Session;
  workspaceId: string;
  workspaceSettings?: import('@claude-air/shared').WorkspaceSettings;
  viewers: import('@claude-air/shared').PresenceUser[];
  [key: string]: unknown;
};

export type AppNodeData = WorkspaceBubbleData | SessionNodeData;
