import { ArrowLeft } from 'lucide-react';
import { useSessionStore } from '@/stores/session.store';
import { MiniTerminalView } from '../terminal/MiniTerminalView';

interface MobileTerminalProps {
  sessionId: string;
  onBack: () => void;
}

export function MobileTerminal({ sessionId, onBack }: MobileTerminalProps) {
  const session = useSessionStore((s) => s.sessions.find((x) => x.id === sessionId));

  return (
    <div className="h-full flex flex-col bg-bg-primary">
      {/* Header */}
      <div className="flex items-center gap-3 px-3 py-2 border-b border-border bg-bg-secondary shrink-0">
        <button onClick={onBack} className="text-text-muted hover:text-text-primary">
          <ArrowLeft size={18} />
        </button>
        <span className="text-sm font-medium text-text-primary truncate">
          {session?.name || 'Session'}
        </span>
      </div>

      {/* Terminal */}
      <div className="flex-1 overflow-hidden">
        <MiniTerminalView sessionId={sessionId} active={true} />
      </div>
    </div>
  );
}
