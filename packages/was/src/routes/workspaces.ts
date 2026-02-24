import { Router, type Response } from 'express';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import pino from 'pino';
import type { ApiResponse, Workspace, WorkspaceSettings, DetectedWorkspace, ClaudeSession, Session } from '@claude-air/shared';
import { getDb } from '../db/database.js';
import { detectWorkspaces, getClaudeStatsMap, getClaudeSessionsForPath } from '../services/workspace-detector.service.js';
import { SmsProxy } from '../services/sms-proxy.js';
import type { AuthenticatedRequest } from '../types.js';

const log = pino({ name: 'workspaces' });

const COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316'];

const WorkspaceSettingsSchema = z.object({
  skipPermissions: z.boolean().optional(),
  claudeArgs: z.string().optional(),
}).optional();

const CreateWorkspaceSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  color: z.string().optional().default('#3b82f6'),
  path: z.string().optional(),
  settings: WorkspaceSettingsSchema,
});

const ImportWorkspacesSchema = z.object({
  workspaces: z.array(z.object({
    path: z.string().min(1),
    name: z.string().min(1).max(100),
    color: z.string().optional(),
  })),
});

interface WorkspaceRow {
  id: string;
  name: string;
  description: string | null;
  color: string;
  path: string | null;
  settings: string | null;
  created_by: string | null;
  created_at: string;
}

function parseSettings(raw: string | null): WorkspaceSettings | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as WorkspaceSettings;
    if (Object.keys(parsed).length === 0) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function rowToWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    color: row.color,
    path: row.path ?? undefined,
    settings: parseSettings(row.settings),
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at,
  };
}

function paramId(req: AuthenticatedRequest): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] : id;
}

export function createWorkspaceRoutes(smsProxy: SmsProxy): Router {
  const router = Router();

  // ── Detect workspaces from ~/.claude/projects/ ──
  router.get('/detect', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const scanDir = typeof req.query.scanDir === 'string' ? req.query.scanDir : undefined;
      const detected = await detectWorkspaces(scanDir);
      const body: ApiResponse<DetectedWorkspace[]> = { ok: true, data: detected };
      res.json(body);
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) } satisfies ApiResponse<never>);
    }
  });

  // ── Bulk import detected workspaces ──
  router.post('/import', (req: AuthenticatedRequest, res: Response) => {
    const parsed = ImportWorkspacesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.message } satisfies ApiResponse<never>);
      return;
    }

    const db = getDb();
    const insert = db.prepare(
      'INSERT INTO workspaces (id, name, color, path, created_by) VALUES (?, ?, ?, ?, ?)',
    );

    const created: Workspace[] = [];
    let colorIndex = 0;

    const insertMany = db.transaction(() => {
      for (const ws of parsed.data.workspaces) {
        const id = uuid();
        const color = ws.color || COLORS[colorIndex % COLORS.length];
        colorIndex++;
        insert.run(id, ws.name, color, ws.path, req.user!.userId);
        const row = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as WorkspaceRow;
        created.push(rowToWorkspace(row));
      }
    });

    insertMany();

    const body: ApiResponse<Workspace[]> = { ok: true, data: created };
    res.status(201).json(body);
  });

  // ── List all workspaces (enriched with Claude Code session stats) ──
  router.get('/', async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const db = getDb();
      const rows = db.prepare('SELECT * FROM workspaces ORDER BY created_at DESC').all() as WorkspaceRow[];
      const workspaces = rows.map(rowToWorkspace);

      const paths = workspaces.map(ws => ws.path).filter((p): p is string => !!p);
      const statsMap = await getClaudeStatsMap(paths);
      const normalizePath = (p: string) => process.platform === 'win32' ? p.toLowerCase().replace(/\//g, '\\') : p;
      for (const ws of workspaces) {
        if (ws.path) {
          const stats = statsMap.get(normalizePath(ws.path));
          if (stats) {
            ws.claudeSessionCount = stats.sessionCount;
            ws.claudeLastActive = stats.lastActive;
          }
        }
      }

      const body: ApiResponse<Workspace[]> = { ok: true, data: workspaces };
      res.json(body);
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) } satisfies ApiResponse<never>);
    }
  });

  // ── Create workspace ──
  router.post('/', (req: AuthenticatedRequest, res: Response) => {
    const parsed = CreateWorkspaceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.message } satisfies ApiResponse<never>);
      return;
    }
    const db = getDb();
    const id = uuid();
    const settingsJson = parsed.data.settings ? JSON.stringify(parsed.data.settings) : '{}';
    db.prepare('INSERT INTO workspaces (id, name, description, color, path, settings, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      id, parsed.data.name, parsed.data.description ?? null, parsed.data.color, parsed.data.path ?? null, settingsJson, req.user!.userId,
    );
    const row = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as WorkspaceRow;
    const body: ApiResponse<Workspace> = { ok: true, data: rowToWorkspace(row) };
    res.status(201).json(body);
  });

  // ── Update workspace ──
  router.put('/:id', (req: AuthenticatedRequest, res: Response) => {
    const parsed = CreateWorkspaceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.message } satisfies ApiResponse<never>);
      return;
    }
    const db = getDb();
    const id = paramId(req);
    db.prepare('UPDATE workspaces SET name = ?, description = ?, color = ? WHERE id = ?').run(
      parsed.data.name, parsed.data.description ?? null, parsed.data.color, id,
    );
    const row = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as WorkspaceRow | undefined;
    if (!row) {
      res.status(404).json({ ok: false, error: 'Workspace not found' } satisfies ApiResponse<never>);
      return;
    }
    const body: ApiResponse<Workspace> = { ok: true, data: rowToWorkspace(row) };
    res.json(body);
  });

  // ── Patch workspace settings ──
  router.patch('/:id/settings', (req: AuthenticatedRequest, res: Response) => {
    const parsed = z.object({
      skipPermissions: z.boolean().optional(),
      claudeArgs: z.string().optional(),
    }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.message } satisfies ApiResponse<never>);
      return;
    }
    const db = getDb();
    const id = paramId(req);
    const row = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as WorkspaceRow | undefined;
    if (!row) {
      res.status(404).json({ ok: false, error: 'Workspace not found' } satisfies ApiResponse<never>);
      return;
    }
    const existing = parseSettings(row.settings) ?? {};
    const merged = { ...existing, ...parsed.data };
    db.prepare('UPDATE workspaces SET settings = ? WHERE id = ?').run(JSON.stringify(merged), id);
    const updated = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as WorkspaceRow;
    const body: ApiResponse<Workspace> = { ok: true, data: rowToWorkspace(updated) };
    res.json(body);
  });

  // ── List Claude Code conversations for a workspace ──
  router.get('/:id/claude-sessions', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = getDb();
      const id = paramId(req);
      const row = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as WorkspaceRow | undefined;
      if (!row || !row.path) {
        res.status(404).json({ ok: false, error: 'Workspace not found or has no path' } satisfies ApiResponse<never>);
        return;
      }

      const entries = await getClaudeSessionsForPath(row.path);
      const sessions: ClaudeSession[] = entries.map((e) => ({
        sessionId: e.sessionId,
        summary: e.summary || 'Untitled conversation',
        messageCount: e.messageCount,
        lastActive: e.modified,
        diskSize: e.diskSize,
        gitBranch: e.gitBranch || undefined,
      }));

      const body: ApiResponse<ClaudeSession[]> = { ok: true, data: sessions };
      res.json(body);
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) } satisfies ApiResponse<never>);
    }
  });

  // ── Delete workspace (cascade-kills all sessions) ──
  router.delete('/:id', async (req: AuthenticatedRequest, res: Response) => {
    const db = getDb();
    const id = paramId(req);

    // Get workspace path before deleting
    const workspace = db.prepare('SELECT path FROM workspaces WHERE id = ?').get(id) as { path: string } | undefined;
    if (!workspace) {
      res.status(404).json({ ok: false, error: 'Workspace not found' } satisfies ApiResponse<never>);
      return;
    }

    // Kill all sessions belonging to this workspace via SMS
    if (workspace.path) {
      try {
        const sessionsData = await smsProxy.listSessions() as { ok: boolean; data: Session[] };
        const sessions = sessionsData.data || [];
        const toKill = sessions.filter(
          (s) => s.workspacePath && s.workspacePath.toLowerCase() === workspace.path.toLowerCase(),
        );
        for (const s of toKill) {
          try {
            await smsProxy.killSession(s.id);
            log.info({ sessionId: s.id, workspace: workspace.path }, 'killed session for deleted workspace');
          } catch (err) {
            log.warn({ err, sessionId: s.id }, 'failed to kill session during workspace delete');
          }
        }
      } catch (err) {
        log.warn({ err }, 'failed to list sessions for workspace cascade delete');
      }
    }

    db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
    res.json({ ok: true } satisfies ApiResponse<void>);
  });

  return router;
}
