import { create } from 'zustand';
import type { PresenceUser } from '@/types';

interface PresenceState {
  users: PresenceUser[];
  setUsers: (users: PresenceUser[]) => void;
  getViewers: (sessionId: string) => PresenceUser[];
}

export const usePresenceStore = create<PresenceState>()((set, get) => ({
  users: [],
  setUsers: (users) => set({ users }),
  getViewers: (sessionId) => get().users.filter((u) => u.viewingSessionId === sessionId),
}));
