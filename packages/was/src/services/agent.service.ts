import Anthropic from '@anthropic-ai/sdk';
import pino from 'pino';
import { config } from '../config.js';
import { SmsProxy } from './sms-proxy.js';

const log = pino({ name: 'agent' });

// Tool definitions for Claude function calling
const TOOLS: Anthropic.Tool[] = [
  {
    name: 'list_sessions',
    description: 'List all Claude Code sessions with their current status, workspace path, and metadata.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_session_status',
    description: 'Get detailed information about a specific session by its ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        session_id: { type: 'string', description: 'The session ID' },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'create_session',
    description: 'Create a new Claude Code session in a workspace directory. This spawns a new tmux session running Claude Code CLI.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Human-readable name for the session' },
        workspace_path: { type: 'string', description: 'Absolute path to the workspace directory' },
        skip_permissions: { type: 'boolean', description: 'Whether to use --dangerously-skip-permissions flag' },
      },
      required: ['name', 'workspace_path'],
    },
  },
  {
    name: 'send_to_session',
    description: 'Send text or keystrokes to a running session terminal. Use this to type commands or interact with Claude Code.',
    input_schema: {
      type: 'object' as const,
      properties: {
        session_id: { type: 'string', description: 'The session ID' },
        keys: { type: 'string', description: 'The text or keys to send (use Enter for newline)' },
      },
      required: ['session_id', 'keys'],
    },
  },
  {
    name: 'read_session_output',
    description: 'Read the current visible content from a session terminal. Returns the last N lines of terminal output.',
    input_schema: {
      type: 'object' as const,
      properties: {
        session_id: { type: 'string', description: 'The session ID' },
        lines: { type: 'number', description: 'Number of lines to capture (default 50)' },
      },
      required: ['session_id'],
    },
  },
  {
    name: 'kill_session',
    description: 'Kill/stop a running session. This terminates the tmux session and Claude Code process.',
    input_schema: {
      type: 'object' as const,
      properties: {
        session_id: { type: 'string', description: 'The session ID to kill' },
      },
      required: ['session_id'],
    },
  },
];

interface ToolInput {
  session_id?: string;
  name?: string;
  workspace_path?: string;
  skip_permissions?: boolean;
  keys?: string;
  lines?: number;
}

export interface AgentResponse {
  content: string;
  toolCalls?: { id: string; name: string; input: Record<string, unknown>; result?: string }[];
}

export class AgentService {
  private client: Anthropic | null = null;
  private smsProxy: SmsProxy;

  constructor(smsProxy: SmsProxy) {
    this.smsProxy = smsProxy;
    if (config.anthropicApiKey) {
      this.client = new Anthropic({ apiKey: config.anthropicApiKey });
    }
  }

  get available(): boolean {
    return !!this.client;
  }

  /**
   * Execute a multi-turn tool-use conversation with Claude.
   */
  async chat(userMessage: string): Promise<AgentResponse> {
    if (!this.client) {
      return { content: 'AI agent is not configured. Set ANTHROPIC_API_KEY in your environment.' };
    }

    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: userMessage },
    ];

    const toolCalls: AgentResponse['toolCalls'] = [];

    // Multi-turn tool-use loop
    for (let turn = 0; turn < 10; turn++) {
      const response = await this.client.messages.create({
        model: config.aiModel,
        max_tokens: config.aiMaxTokens,
        system: `You are an AI assistant that helps manage Claude Code sessions. You can list, create, monitor, and interact with running Claude Code terminal sessions. Be concise and helpful.`,
        tools: TOOLS,
        messages,
      });

      // Collect text and tool_use blocks
      const textParts: string[] = [];
      const toolUseBlocks: Anthropic.ToolUseBlock[] = [];

      for (const block of response.content) {
        if (block.type === 'text') {
          textParts.push(block.text);
        } else if (block.type === 'tool_use') {
          toolUseBlocks.push(block);
        }
      }

      // If no tool calls, we're done
      if (toolUseBlocks.length === 0) {
        return { content: textParts.join('\n'), toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
      }

      // Execute tool calls
      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        const input = toolUse.input as ToolInput;
        let result: string;

        try {
          result = await this.executeTool(toolUse.name, input);
        } catch (err) {
          result = `Error: ${err}`;
        }

        toolCalls.push({
          id: toolUse.id,
          name: toolUse.name,
          input: toolUse.input as Record<string, unknown>,
          result,
        });

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: result,
        });
      }

      messages.push({ role: 'user', content: toolResults });

      // If stop_reason was end_turn, break
      if (response.stop_reason === 'end_turn') {
        return { content: textParts.join('\n'), toolCalls };
      }
    }

    return { content: 'Agent reached maximum tool-use turns.', toolCalls };
  }

  private async executeTool(name: string, input: ToolInput): Promise<string> {
    log.info({ tool: name, input }, 'executing agent tool');

    switch (name) {
      case 'list_sessions': {
        const data = await this.smsProxy.listSessions();
        return JSON.stringify(data, null, 2);
      }

      case 'get_session_status': {
        const data = await this.smsProxy.getSession(input.session_id!);
        return JSON.stringify(data, null, 2);
      }

      case 'create_session': {
        const data = await this.smsProxy.createSession({
          name: input.name!,
          workspacePath: input.workspace_path!,
          skipPermissions: input.skip_permissions,
        });
        return JSON.stringify(data, null, 2);
      }

      case 'send_to_session': {
        await this.smsProxy.sendKeys(input.session_id!, input.keys!);
        return 'Keys sent successfully.';
      }

      case 'read_session_output': {
        const data = await this.smsProxy.captureOutput(input.session_id!, input.lines || 50);
        return JSON.stringify(data, null, 2);
      }

      case 'kill_session': {
        await this.smsProxy.killSession(input.session_id!);
        return 'Session killed successfully.';
      }

      default:
        return `Unknown tool: ${name}`;
    }
  }
}
