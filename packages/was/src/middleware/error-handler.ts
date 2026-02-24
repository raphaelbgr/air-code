import type { Request, Response, NextFunction } from 'express';
import pino from 'pino';

const log = pino({ name: 'error-handler' });

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  log.error({ err }, 'unhandled error');
  res.status(500).json({ ok: false, error: 'Internal server error' });
}
