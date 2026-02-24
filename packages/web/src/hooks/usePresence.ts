import { useEffect } from 'react';
import { useAuthStore } from '@/stores/auth.store';
import { usePresenceStore } from '@/stores/presence.store';
import { getSocket, disconnectSocket } from '@/lib/socket';
import { PRESENCE_USERS, PRESENCE_UPDATE } from '@claude-air/shared';
import type { PresenceUser } from '@/types';

export function usePresence() {
  const token = useAuthStore((s) => s.token);
  const setUsers = usePresenceStore((s) => s.setUsers);

  useEffect(() => {
    if (!token) return;

    const socket = getSocket(token);

    socket.on(PRESENCE_USERS, (users: PresenceUser[]) => {
      setUsers(users);
    });

    return () => {
      socket.off(PRESENCE_USERS);
    };
  }, [token, setUsers]);
}

export function useUpdatePresence(sessionId: string | null) {
  const token = useAuthStore((s) => s.token);

  useEffect(() => {
    if (!token) return;
    const socket = getSocket(token);
    socket.emit(PRESENCE_UPDATE, { sessionId });
  }, [token, sessionId]);
}
