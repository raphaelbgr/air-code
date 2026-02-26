// ── Session types ──

export type SessionStatus = 'running' | 'idle' | 'stopped' | 'error';
export type SessionType = 'shell' | 'claude';
export type SessionBackend = 'tmux' | 'pty';

export interface Session {
  id: string;
  name: string;
  tmuxSession: string;
  workspacePath: string;
  status: SessionStatus;
  type: SessionType;
  skipPermissions: boolean;
  claudeSessionId?: string;
  backend?: SessionBackend;
  createdAt: string;
  lastActivity: string;
}

export interface CreateSessionRequest {
  name: string;
  workspacePath: string;
  type?: SessionType;
  skipPermissions?: boolean;
  claudeArgs?: string;
  claudeResumeId?: string;
  forkSession?: boolean;
  backend?: SessionBackend;
}

export interface ClaudeSession {
  sessionId: string;
  summary: string;
  messageCount: number;
  lastActive: string;
  diskSize?: number;
  gitBranch?: string;
}

export interface SendKeysRequest {
  keys: string;
}

// ── Workspace types ──

export interface WorkspaceSettings {
  skipPermissions?: boolean;
  claudeArgs?: string;
}

export interface Workspace {
  id: string;
  name: string;
  description?: string;
  color: string;
  path?: string;
  settings?: WorkspaceSettings;
  createdBy?: string;
  createdAt: string;
  claudeSessionCount?: number;
  claudeLastActive?: string;
}

export interface DetectedWorkspace {
  path: string;
  name: string;
  sessionCount: number;
  lastActive: string;
  alreadyImported: boolean;
}

export interface CreateWorkspaceRequest {
  name: string;
  description?: string;
  color?: string;
}

// ── Auth types ──

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatarColor: string;
  createdAt: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  password: string;
  displayName: string;
  inviteCode: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

// ── Canvas types ──

export interface CanvasNodeData {
  type: 'workspace' | 'session';
  workspaceId?: string;
  sessionId?: string;
}

export interface CanvasState {
  nodes: unknown[];
  edges: unknown[];
  viewport: { x: number; y: number; zoom: number };
}

// ── Presence types ──

export interface PresenceUser {
  userId: string;
  username: string;
  displayName: string;
  avatarColor: string;
  viewingSessionId?: string;
}

// ── WebSocket message types ──

export type WsMessageType =
  | 'terminal:data'
  | 'terminal:resize'
  | 'terminal:resized'
  | 'terminal:input'
  | 'terminal:subscribe'
  | 'terminal:unsubscribe'
  | 'terminal:error';

export interface WsMessage {
  type: WsMessageType;
  sessionId: string;
  data?: string;
  cols?: number;
  rows?: number;
  preview?: boolean;
  error?: string;
  code?: number;
}

// ── Agent types ──

export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: AgentToolCall[];
  timestamp: string;
}

export interface AgentToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: string;
}

export interface AgentChatRequest {
  message: string;
  conversationId?: string;
}

// ── Browse types ──

export interface BrowseItem {
  name: string;
  isDir: boolean;
  description?: string;
}

export interface BrowseResult {
  path: string;
  parent: string | null;
  items: BrowseItem[];
}

// ── API response wrapper ──

export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

// ── Health ──

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  version: string;
  uptime: number;
  os?: string;
  hostname?: string;
}
