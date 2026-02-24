import { Router, type Response } from 'express';
import type { ApiResponse, CanvasState } from '@claude-air/shared';
import { CanvasService } from '../services/canvas.service.js';
import type { AuthenticatedRequest } from '../types.js';

export function createCanvasRoutes(canvasService: CanvasService): Router {
  const router = Router();

  router.get('/', (req: AuthenticatedRequest, res: Response) => {
    const state = canvasService.get(req.user!.userId);
    const body: ApiResponse<CanvasState> = { ok: true, data: state };
    res.json(body);
  });

  router.put('/', (req: AuthenticatedRequest, res: Response) => {
    canvasService.save(req.user!.userId, req.body);
    res.json({ ok: true } satisfies ApiResponse<void>);
  });

  return router;
}
