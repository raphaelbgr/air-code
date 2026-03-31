import type { Response, NextFunction } from 'express';
import pino from 'pino';
import { AuthService } from '../services/auth.service.js';
import type { AuthenticatedRequest } from '../types.js';

const log = pino({ name: 'auth-middleware' });

export function createAuthMiddleware(authService: AuthService) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      res.status(401).json({ ok: false, error: 'Missing authorization header' });
      return;
    }

    const token = authHeader.substring(7);
    try {
      req.user = authService.verifyToken(token);
      next();
    } catch {
      log.debug('invalid token');
      res.status(401).json({ ok: false, error: 'Invalid or expired token' });
    }
  };
}
