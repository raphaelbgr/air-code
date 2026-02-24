import { Bot } from 'lucide-react';
import { useAgentStore } from '@/stores/agent.store';

export function MobileFAB() {
  const toggleAgent = useAgentStore((s) => s.togglePanel);

  return (
    <button
      onClick={toggleAgent}
      className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-accent hover:bg-accent-hover shadow-lg flex items-center justify-center transition-transform active:scale-95"
    >
      <Bot size={24} className="text-white" />
    </button>
  );
}
