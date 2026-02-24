import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { ApiResponse, AuthResponse } from '@claude-air/shared';
import { AuthService } from '../services/auth.service.js';

const RegisterSchema = z.object({
  username: z.string().min(3).max(30),
  password: z.string().min(6),
  displayName: z.string().min(1).max(50),
  inviteCode: z.string().min(1),
});

const LoginSchema = z.object({
  username: z.string(),
  password: z.string(),
});

export function createAuthRoutes(authService: AuthService): Router {
  const router = Router();

  router.post('/register', async (req: Request, res: Response) => {
    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.message } satisfies ApiResponse<never>);
      return;
    }
    try {
      const result = await authService.register(
        parsed.data.username,
        parsed.data.password,
        parsed.data.displayName,
        parsed.data.inviteCode,
      );
      const body: ApiResponse<AuthResponse> = { ok: true, data: result };
      res.status(201).json(body);
    } catch (err) {
      res.status(400).json({ ok: false, error: String(err) } satisfies ApiResponse<never>);
    }
  });

  router.post('/login', async (req: Request, res: Response) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.message } satisfies ApiResponse<never>);
      return;
    }
    try {
      const result = await authService.login(parsed.data.username, parsed.data.password);
      const body: ApiResponse<AuthResponse> = { ok: true, data: result };
      res.json(body);
    } catch (err) {
      res.status(401).json({ ok: false, error: String(err) } satisfies ApiResponse<never>);
    }
  });

  return router;
}
