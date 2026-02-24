import { Router, type Request, type Response } from 'express';
import type { HealthResponse } from '@claude-air/shared';
import { VERSION } from '@claude-air/shared';
import { SessionService } from '../services/session.service.js';

const startTime = Date.now();

export function createHealthRoutes(sessionService: SessionService): Router {
  const router = Router();

  router.get('/', (_req: Request, res: Response) => {
    const tmuxOk = sessionService.checkTmux();
    const response = {
      status: tmuxOk ? 'ok' : (sessionService.isMockMode ? 'ok' : 'degraded'),
      version: VERSION,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      mock: sessionService.isMockMode,
    };
    res.json(response);
  });

  return router;
}
