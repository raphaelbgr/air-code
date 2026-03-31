import { create } from 'zustand';
import type { Session, Workspace } from '@/types';
import { api } from '@/lib/api';

interface SessionState {
  sessions: Session[];
  workspaces: Workspace[];
  loading: boolean;
  error: string | null;
  fetchSessions: () => Promise<void>;
  fetchWorkspaces: () => Promise<void>;
  fetchAll: () => Promise<void>;
  addSession: (session: Session) => void;
  removeSession: (id: string) => void;
  updateSession: (id: string, updates: Partial<Session>) => void;
  addWorkspace: (workspace: Workspace) => void;
  removeWorkspace: (id: string) => void;
}

export const useSessionStore = create<SessionState>()((set, get) => ({
  sessions: [],
  workspaces: [],
  loading: false,
  error: null,

  fetchSessions: async () => {
    try {
      const sessions = await api.sessions.list();
      set({ sessions });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  fetchWorkspaces: async () => {
    try {
      const workspaces = await api.workspaces.list();
      set({ workspaces });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  fetchAll: async () => {
    set({ loading: true, error: null });
    await Promise.all([get().fetchSessions(), get().fetchWorkspaces()]);
    set({ loading: false });
  },

  addSession: (session) => set((s) => ({ sessions: [...s.sessions, session] })),
  removeSession: (id) => set((s) => ({ sessions: s.sessions.filter((x) => x.id !== id) })),
  updateSession: (id, updates) =>
    set((s) => ({
      sessions: s.sessions.map((x) => (x.id === id ? { ...x, ...updates } : x)),
    })),

  addWorkspace: (workspace) => set((s) => ({ workspaces: [...s.workspaces, workspace] })),
  removeWorkspace: (id) => set((s) => ({ workspaces: s.workspaces.filter((x) => x.id !== id) })),
}));
