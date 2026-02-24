import { useEffect, useRef } from 'react';
import { useTerminal } from '@/hooks/useTerminal';

interface TerminalViewProps {
  sessionId: string;
}

export function TerminalView({ sessionId }: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  useTerminal(sessionId, containerRef);

  return (
    <div
      ref={containerRef}
      className="w-full h-full bg-black"
      data-session-id={sessionId}
    />
  );
}
