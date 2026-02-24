import { create } from 'zustand';

interface TerminalMeta {
  sessionId: string;
  connected: boolean;
  cols: number;
  rows: number;
}

interface TerminalState {
  terminals: Map<string, TerminalMeta>;
  setTerminalMeta: (sessionId: string, meta: Partial<TerminalMeta>) => void;
  removeTerminal: (sessionId: string) => void;
  isConnected: (sessionId: string) => boolean;
}

export const useTerminalStore = create<TerminalState>()((set, get) => ({
  terminals: new Map(),

  setTerminalMeta: (sessionId, meta) =>
    set((state) => {
      const terminals = new Map(state.terminals);
      const existing = terminals.get(sessionId) || {
        sessionId,
        connected: false,
        cols: 80,
        rows: 24,
      };
      terminals.set(sessionId, { ...existing, ...meta });
      return { terminals };
    }),

  removeTerminal: (sessionId) =>
    set((state) => {
      const terminals = new Map(state.terminals);
      terminals.delete(sessionId);
      return { terminals };
    }),

  isConnected: (sessionId) => get().terminals.get(sessionId)?.connected ?? false,
}));
