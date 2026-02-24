import { useState, useEffect } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { CanvasView } from '../canvas/CanvasView';
import { SearchDialog } from '../canvas/SearchDialog';
import { AgentPanel } from '../agent/AgentPanel';
import { MobileListView } from '../mobile/MobileListView';
import { MobileTerminal } from '../mobile/MobileTerminal';
import { MobileFAB } from '../mobile/MobileFAB';
import { CreateWorkspaceDialog } from '../dialogs/CreateWorkspaceDialog';
import { CreateSessionDialog } from '../dialogs/CreateSessionDialog';
import { usePresence, useUpdatePresence } from '@/hooks/usePresence';
import { useMobileDetect } from '@/hooks/useMobileDetect';
import { useCanvasSync } from '@/hooks/useCanvasSync';
import { useAuthStore } from '@/stores/auth.store';
import { useAgentStore } from '@/stores/agent.store';
import { useCanvasStore } from '@/stores/canvas.store';
import { useSessionStore } from '@/stores/session.store';
import { LogOut, User } from 'lucide-react';
import { SaveStatusIcon } from '../canvas/SaveStatusIcon';

export function AppLayout() {
  usePresence();
  useCanvasSync();
  const activeSessionId = useCanvasStore((s) => s.activeSessionId);
  useUpdatePresence(activeSessionId);

  const { user, logout } = useAuthStore();
  const agentPanelOpen = useAgentStore((s) => s.panelOpen);
  const { isMobile } = useMobileDetect();
  const fetchAll = useSessionStore((s) => s.fetchAll);

  // Mobile state
  const [mobileSessionId, setMobileSessionId] = useState<string | null>(null);
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false);
  const [showCreateSession, setShowCreateSession] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  // Fetch data on mount (mobile)
  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 5000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  // Cmd+K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowSearch((v) => !v);
      }
      if (e.key === 'Escape') {
        setShowSearch(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Mobile: fullscreen terminal
  if (isMobile && mobileSessionId) {
    return (
      <>
        <MobileTerminal sessionId={mobileSessionId} onBack={() => setMobileSessionId(null)} />
        {agentPanelOpen && <AgentPanel />}
      </>
    );
  }

  // Mobile: list view
  if (isMobile) {
    return (
      <div className="h-screen w-screen flex flex-col bg-bg-primary overflow-hidden">
        <TopBar user={user} onLogout={logout} />
        <div className="flex-1 overflow-hidden">
          <MobileListView
            onSessionTap={setMobileSessionId}
            onCreateWorkspace={() => setShowCreateWorkspace(true)}
            onCreateSession={() => setShowCreateSession(true)}
          />
        </div>
        <MobileFAB />
        {agentPanelOpen && <AgentPanel />}
        {showCreateWorkspace && <CreateWorkspaceDialog onClose={() => setShowCreateWorkspace(false)} />}
        {showCreateSession && <CreateSessionDialog onClose={() => setShowCreateSession(false)} />}
      </div>
    );
  }

  // Desktop: full canvas
  return (
    <div className="h-screen w-screen flex flex-col bg-bg-primary overflow-hidden">
      <TopBar user={user} onLogout={logout} />

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-hidden">
          <ReactFlowProvider>
            <CanvasView />
            <SearchDialog open={showSearch} onClose={() => setShowSearch(false)} />
          </ReactFlowProvider>
        </div>

        {agentPanelOpen && <AgentPanel />}
      </div>
    </div>
  );
}

function TopBar({ user, onLogout }: { user: { displayName: string } | null; onLogout: () => void }) {
  return (
    <div className="h-10 flex items-center justify-between px-4 border-b border-border bg-bg-secondary shrink-0">
      <div className="flex items-center gap-2">
        <span className="text-accent font-bold text-sm">Claude Code Air</span>
      </div>
      <div className="flex items-center gap-3">
        <SaveStatusIcon />
        {user && (
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <User size={14} />
            <span>{user.displayName}</span>
          </div>
        )}
        <button onClick={onLogout} className="text-text-muted hover:text-text-primary transition" title="Sign out">
          <LogOut size={14} />
        </button>
      </div>
    </div>
  );
}
