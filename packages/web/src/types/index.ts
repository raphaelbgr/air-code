export type {
  Session,
  SessionType,
  Workspace,
  DetectedWorkspace,
  CliSession,
  User,
  CanvasState,
  PresenceUser,
  AgentMessage,
  AgentToolCall,
  ApiResponse,
} from '@air-code/shared';

// ReactFlow node data types - must satisfy Record<string, unknown>
export type WorkspaceBubbleData = {
  type: 'workspace';
  workspace: import('@air-code/shared').Workspace;
  sessionCount: number;
  cliSessionCount: number;
  collapsed: boolean;
  [key: string]: unknown;
};

export type SessionNodeData = {
  type: 'session';
  session: import('@air-code/shared').Session;
  workspaceId: string;
  workspaceSettings?: import('@air-code/shared').WorkspaceSettings;
  viewers: import('@air-code/shared').PresenceUser[];
  [key: string]: unknown;
};

export type AppNodeData = WorkspaceBubbleData | SessionNodeData;
