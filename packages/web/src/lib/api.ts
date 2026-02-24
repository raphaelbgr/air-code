import type {
  ApiResponse,
  Session,
  SessionType,
  SessionBackend,
  Workspace,
  WorkspaceSettings,
  DetectedWorkspace,
  ClaudeSession,
  AuthResponse,
  CanvasState,
} from '@claude-air/shared';

const BASE = '/api';

function getToken(): string | null {
  try {
    const raw = localStorage.getItem('auth');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed.state?.token ?? parsed.token ?? null;
  } catch {
    return null;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  const data = (await res.json()) as ApiResponse<T>;
  if (!data.ok) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return data.data as T;
}

// ── Auth ──

export const api = {
  auth: {
    login: (username: string, password: string) =>
      request<AuthResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }),
    register: (username: string, password: string, displayName: string, inviteCode: string) =>
      request<AuthResponse>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username, password, displayName, inviteCode }),
      }),
  },

  // ── Sessions ──
  sessions: {
    list: () => request<Session[]>('/sessions'),
    get: (id: string) => request<Session>(`/sessions/${id}`),
    create: (body: { name: string; workspacePath: string; workspaceId?: string; type?: SessionType; skipPermissions?: boolean; claudeArgs?: string; claudeResumeId?: string; forkSession?: boolean; backend?: SessionBackend }) =>
      request<Session>('/sessions', { method: 'POST', body: JSON.stringify(body) }),
    kill: (id: string) => request<void>(`/sessions/${id}`, { method: 'DELETE' }),
    rename: (id: string, name: string) =>
      request<Session>(`/sessions/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
    sendKeys: (id: string, keys: string) =>
      request<void>(`/sessions/${id}/send`, { method: 'POST', body: JSON.stringify({ keys }) }),
    reattach: (id: string) =>
      request<Session>(`/sessions/${id}/reattach`, { method: 'POST' }),
    captureOutput: (id: string, lines = 100) =>
      request<string>(`/sessions/${id}/output?lines=${lines}`),
  },

  // ── Workspaces ──
  workspaces: {
    list: () => request<Workspace[]>('/workspaces'),
    create: (body: { name: string; description?: string; color?: string }) =>
      request<Workspace>('/workspaces', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: { name: string; description?: string; color?: string }) =>
      request<Workspace>(`/workspaces/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
    delete: (id: string) => request<void>(`/workspaces/${id}`, { method: 'DELETE' }),
    detect: (scanDir?: string) =>
      request<DetectedWorkspace[]>(`/workspaces/detect${scanDir ? `?scanDir=${encodeURIComponent(scanDir)}` : ''}`),
    import: (workspaces: { path: string; name: string; color?: string }[]) =>
      request<Workspace[]>('/workspaces/import', {
        method: 'POST',
        body: JSON.stringify({ workspaces }),
      }),
    updateSettings: (id: string, settings: WorkspaceSettings) =>
      request<Workspace>(`/workspaces/${id}/settings`, {
        method: 'PATCH',
        body: JSON.stringify(settings),
      }),
    claudeSessions: (id: string) =>
      request<ClaudeSession[]>(`/workspaces/${id}/claude-sessions`),
  },

  // ── Canvas ──
  canvas: {
    get: () => request<CanvasState>('/canvas'),
    save: (state: CanvasState) =>
      request<void>('/canvas', { method: 'PUT', body: JSON.stringify(state) }),
  },
};
