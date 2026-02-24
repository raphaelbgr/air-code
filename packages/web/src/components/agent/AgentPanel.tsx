import { useState, useRef, useEffect, type FormEvent } from 'react';
import { X, Send, Bot } from 'lucide-react';
import { serverNow } from '@claude-air/shared';
import { useAgentStore } from '@/stores/agent.store';
import type { AgentMessage } from '@/types';
const uuid = () => crypto.randomUUID();

export function AgentPanel() {
  const { messages, loading, panelOpen, addMessage, setLoading, closePanel } = useAgentStore();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (!panelOpen) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMsg: AgentMessage = {
      id: uuid(),
      role: 'user',
      content: input.trim(),
      timestamp: serverNow(),
    };
    addMessage(userMsg);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${JSON.parse(localStorage.getItem('auth') || '{}').token}`,
        },
        body: JSON.stringify({ message: userMsg.content }),
      });
      const data = await res.json();
      const assistantMsg: AgentMessage = {
        id: uuid(),
        role: 'assistant',
        content: data.data?.content || data.error || 'No response',
        toolCalls: data.data?.toolCalls,
        timestamp: serverNow(),
      };
      addMessage(assistantMsg);
    } catch (err) {
      addMessage({
        id: uuid(),
        role: 'assistant',
        content: `Error: ${err}`,
        timestamp: serverNow(),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-80 border-l border-border bg-bg-secondary flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Bot size={16} className="text-accent" />
        <span className="font-semibold text-text-primary text-sm">AI Agent</span>
        <button onClick={closePanel} className="ml-auto text-text-muted hover:text-text-primary">
          <X size={16} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <p className="text-text-muted text-sm text-center mt-8">
            Ask me to manage sessions, check status, or run commands.
          </p>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`text-sm rounded-lg px-3 py-2 ${
              msg.role === 'user'
                ? 'bg-accent/20 text-text-primary ml-8'
                : 'bg-bg-tertiary text-text-secondary mr-4'
            }`}
          >
            {msg.content}
            {msg.toolCalls?.map((tc) => (
              <div key={tc.id} className="mt-1 text-xs text-text-muted border-t border-border pt-1">
                Tool: {tc.name}
              </div>
            ))}
          </div>
        ))}
        {loading && (
          <div className="text-sm text-text-muted animate-pulse">Thinking...</div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-3 border-t border-border">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask the agent..."
            className="flex-1 px-3 py-2 rounded-lg bg-bg-tertiary border border-border text-text-primary placeholder:text-text-muted text-sm focus:outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-3 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white transition disabled:opacity-50"
          >
            <Send size={14} />
          </button>
        </div>
      </form>
    </div>
  );
}
