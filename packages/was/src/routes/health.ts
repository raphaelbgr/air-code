import { Router, type Request, type Response } from 'express';
import type { HealthResponse } from '@claude-air/shared';
import { VERSION } from '@claude-air/shared';
import { SmsProxy } from '../services/sms-proxy.js';

const startTime = Date.now();

export function createHealthRoutes(smsProxy: SmsProxy): Router {
  const router = Router();

  router.get('/', async (_req: Request, res: Response) => {
    let smsOk = false;
    let smsOs: string | undefined;
    let smsHostname: string | undefined;
    try {
      const smsHealth = await smsProxy.health() as HealthResponse;
      smsOk = true;
      smsOs = smsHealth.os;
      smsHostname = smsHealth.hostname;
    } catch { /* SMS unreachable */ }

    const response: HealthResponse = {
      status: smsOk ? 'ok' : 'degraded',
      version: VERSION,
      uptime: Math.floor((Date.now() - startTime) / 1000),
      os: smsOs,
      hostname: smsHostname,
    };
    res.json(response);
  });

  return router;
}
