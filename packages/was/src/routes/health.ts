import { Router, type Request, type Response } from 'express';
import type { HealthResponse } from '@claude-air/shared';
import { VERSION } from '@claude-air/shared';
import { SmsProxy } from '../services/sms-proxy.js';

const startTime = Date.now();

export function createHealthRoutes(smsProxy: SmsProxy): Router {
  const router = Router();

  router.get('/', async (_req: Request, res: Response) => {
    let smsOk = false;
    try {
      await smsProxy.health();
      smsOk = true;
    } catch { /* SMS unreachable */ }

    const response: HealthResponse = {
      status: smsOk ? 'ok' : 'degraded',
      version: VERSION,
      uptime: Math.floor((Date.now() - startTime) / 1000),
    };
    res.json(response);
  });

  return router;
}
