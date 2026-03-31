import { create } from 'zustand';
import type { AgentMessage } from '@/types';

interface AgentState {
  messages: AgentMessage[];
  loading: boolean;
  panelOpen: boolean;
  addMessage: (msg: AgentMessage) => void;
  setLoading: (loading: boolean) => void;
  togglePanel: () => void;
  openPanel: () => void;
  closePanel: () => void;
  clear: () => void;
}

export const useAgentStore = create<AgentState>()((set) => ({
  messages: [],
  loading: false,
  panelOpen: false,

  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  setLoading: (loading) => set({ loading }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false }),
  clear: () => set({ messages: [] }),
}));
