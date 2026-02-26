import { Router, json as expressJson, raw as expressRaw, type Request, type Response } from 'express';
import { z } from 'zod';
import { tmpdir } from 'node:os';
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { ApiResponse, Session } from '@claude-air/shared';
import { SessionService } from '../services/session.service.js';

const CreateSessionSchema = z.object({
  name: z.string().min(1).max(100),
  workspacePath: z.string().min(1),
  type: z.enum(['shell', 'claude']).optional(),
  backend: z.enum(['tmux', 'pty']).optional(),
  skipPermissions: z.boolean().optional().default(false),
  claudeArgs: z.string().optional(),
  claudeResumeId: z.string().optional(),
});

const SendKeysSchema = z.object({
  keys: z.string(),
});

const RenameSchema = z.object({
  name: z.string().min(1).max(100),
});

const ReopenSchema = z.object({
  claudeArgs: z.string().optional(),
});

function paramId(req: Request): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] : id;
}

export function createSessionRoutes(sessionService: SessionService): Router {
  const router = Router();

  // List all sessions
  router.get('/', (_req: Request, res: Response) => {
    const sessions = sessionService.list();
    const body: ApiResponse<Session[]> = { ok: true, data: sessions };
    res.json(body);
  });

  // Get a single session
  router.get('/:id', (req: Request, res: Response) => {
    const session = sessionService.get(paramId(req));
    if (!session) {
      res.status(404).json({ ok: false, error: 'Session not found' } satisfies ApiResponse<never>);
      return;
    }
    const body: ApiResponse<Session> = { ok: true, data: session };
    res.json(body);
  });

  // Create a new session
  router.post('/', async (req: Request, res: Response) => {
    const parsed = CreateSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.message } satisfies ApiResponse<never>);
      return;
    }
    try {
      const session = await sessionService.create(parsed.data);
      const body: ApiResponse<Session> = { ok: true, data: session };
      res.status(201).json(body);
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) } satisfies ApiResponse<never>);
    }
  });

  // Kill a session
  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      await sessionService.kill(paramId(req));
      res.json({ ok: true } satisfies ApiResponse<void>);
    } catch (err) {
      res.status(404).json({ ok: false, error: String(err) } satisfies ApiResponse<never>);
    }
  });

  // Rename a session
  router.put('/:id', (req: Request, res: Response) => {
    const parsed = RenameSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.message } satisfies ApiResponse<never>);
      return;
    }
    const session = sessionService.rename(paramId(req), parsed.data.name);
    if (!session) {
      res.status(404).json({ ok: false, error: 'Session not found' } satisfies ApiResponse<never>);
      return;
    }
    const body: ApiResponse<Session> = { ok: true, data: session };
    res.json(body);
  });

  // Reattach control mode to a session (reconnect tmux streaming)
  router.post('/:id/reattach', (req: Request, res: Response) => {
    try {
      const session = sessionService.reattach(paramId(req));
      if (!session) {
        res.status(404).json({ ok: false, error: 'Session not found' } satisfies ApiResponse<never>);
        return;
      }
      const body: ApiResponse<Session> = { ok: true, data: session };
      res.json(body);
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) } satisfies ApiResponse<never>);
    }
  });

  // Reopen a stopped session (creates fresh tmux/PTY with original metadata)
  router.post('/:id/reopen', async (req: Request, res: Response) => {
    const parsed = ReopenSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.message } satisfies ApiResponse<never>);
      return;
    }
    try {
      const session = await sessionService.reopen(paramId(req), parsed.data.claudeArgs);
      const body: ApiResponse<Session> = { ok: true, data: session };
      res.json(body);
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) } satisfies ApiResponse<never>);
    }
  });

  // Send keys to a session
  router.post('/:id/send', async (req: Request, res: Response) => {
    const parsed = SendKeysSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.message } satisfies ApiResponse<never>);
      return;
    }
    try {
      await sessionService.sendKeys(paramId(req), parsed.data.keys);
      res.json({ ok: true } satisfies ApiResponse<void>);
    } catch (err) {
      res.status(404).json({ ok: false, error: String(err) } satisfies ApiResponse<never>);
    }
  });

  // Capture session output
  router.get('/:id/output', async (req: Request, res: Response) => {
    try {
      const lines = parseInt(req.query.lines as string, 10) || 100;
      const output = await sessionService.captureOutput(paramId(req), lines);
      const body: ApiResponse<string> = { ok: true, data: output };
      res.json(body);
    } catch (err) {
      res.status(404).json({ ok: false, error: String(err) } satisfies ApiResponse<never>);
    }
  });

  // Paste image — save to temp file and return path
  router.post('/:id/paste-image', expressRaw({ type: 'image/*', limit: '10mb' }), (req: Request, res: Response) => {
    const session = sessionService.get(paramId(req));
    if (!session) {
      res.status(404).json({ ok: false, error: 'Session not found' } satisfies ApiResponse<never>);
      return;
    }
    const buf = req.body as Buffer;
    if (!buf || !buf.length) {
      res.status(400).json({ ok: false, error: 'No image data' } satisfies ApiResponse<never>);
      return;
    }
    const extMap: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/bmp': 'bmp',
    };
    const ext = extMap[req.headers['content-type'] as string] ?? 'png';
    const filename = `paste-${randomUUID().slice(0, 8)}.${ext}`;
    const filePath = join(tmpdir(), filename);
    writeFileSync(filePath, buf);
    const body: ApiResponse<{ path: string }> = { ok: true, data: { path: filePath } };
    res.json(body);
  });

  return router;
}
