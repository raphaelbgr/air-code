import { Router, type Response } from 'express';
import { z } from 'zod';
import pino from 'pino';
import type { ApiResponse } from '@claude-air/shared';
import { AgentService, type AgentResponse } from '../services/agent.service.js';
import type { AuthenticatedRequest } from '../types.js';

const log = pino({ name: 'agent-route' });

const ChatSchema = z.object({
  message: z.string().min(1),
  conversationId: z.string().optional(),
});

export function createAgentRoutes(agentService: AgentService): Router {
  const router = Router();

  router.post('/chat', async (req: AuthenticatedRequest, res: Response) => {
    if (!agentService.available) {
      res.status(503).json({
        ok: false,
        error: 'AI agent not configured. Set ANTHROPIC_API_KEY.',
      } satisfies ApiResponse<never>);
      return;
    }

    const parsed = ChatSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.message } satisfies ApiResponse<never>);
      return;
    }

    try {
      log.info({ userId: req.user?.userId, message: parsed.data.message.substring(0, 100) }, 'agent chat request');
      const result = await agentService.chat(parsed.data.message);
      const body: ApiResponse<AgentResponse> = { ok: true, data: result };
      res.json(body);
    } catch (err) {
      log.error({ err }, 'agent chat error');
      res.status(500).json({ ok: false, error: String(err) } satisfies ApiResponse<never>);
    }
  });

  return router;
}
