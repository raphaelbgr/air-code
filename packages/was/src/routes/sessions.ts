import { Router, raw as expressRaw, type Response } from 'express';
import { z } from 'zod';
import { SmsProxy } from '../services/sms-proxy.js';
import type { AuthenticatedRequest } from '../types.js';

const CreateSessionSchema = z.object({
  name: z.string().min(1).max(100),
  workspacePath: z.string().min(1),
  workspaceId: z.string().optional(),
  type: z.enum(['shell', 'claude']).optional(),
  backend: z.enum(['tmux', 'pty']).optional(),
  skipPermissions: z.boolean().optional().default(false),
  claudeArgs: z.string().optional(),
  claudeResumeId: z.string().optional(),
  forkSession: z.boolean().optional(),
});

const SendKeysSchema = z.object({
  keys: z.string(),
});

function paramId(req: AuthenticatedRequest): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] : id;
}

export function createSessionRoutes(smsProxy: SmsProxy): Router {
  const router = Router();

  router.get('/', async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const data = await smsProxy.listSessions();
      res.json(data);
    } catch (err) {
      res.status(502).json({ ok: false, error: `SMS unavailable: ${err}` });
    }
  });

  router.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const data = await smsProxy.getSession(paramId(req));
      res.json(data);
    } catch (err) {
      res.status(502).json({ ok: false, error: String(err) });
    }
  });

  router.post('/', async (req: AuthenticatedRequest, res: Response) => {
    const parsed = CreateSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.message });
      return;
    }
    try {
      const data = await smsProxy.createSession(parsed.data);
      res.status(201).json(data);
    } catch (err) {
      res.status(502).json({ ok: false, error: String(err) });
    }
  });

  router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const data = await smsProxy.killSession(paramId(req));
      res.json(data);
    } catch (err) {
      res.status(502).json({ ok: false, error: String(err) });
    }
  });

  router.post('/:id/reattach', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const data = await smsProxy.reattachSession(paramId(req));
      res.json(data);
    } catch (err) {
      res.status(502).json({ ok: false, error: String(err) });
    }
  });

  router.post('/:id/send', async (req: AuthenticatedRequest, res: Response) => {
    const parsed = SendKeysSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.message });
      return;
    }
    try {
      const data = await smsProxy.sendKeys(paramId(req), parsed.data.keys);
      res.json(data);
    } catch (err) {
      res.status(502).json({ ok: false, error: String(err) });
    }
  });

  router.get('/:id/output', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const lines = parseInt(req.query.lines as string, 10) || 100;
      const data = await smsProxy.captureOutput(paramId(req), lines);
      res.json(data);
    } catch (err) {
      res.status(502).json({ ok: false, error: String(err) });
    }
  });

  router.post('/:id/paste-image', expressRaw({ type: 'image/*', limit: '10mb' }), async (req: AuthenticatedRequest, res: Response) => {
    try {
      const data = await smsProxy.uploadImage(
        paramId(req),
        req.body as Buffer,
        req.headers['content-type'] || 'image/png',
      );
      res.json(data);
    } catch (err) {
      res.status(502).json({ ok: false, error: String(err) });
    }
  });

  return router;
}
