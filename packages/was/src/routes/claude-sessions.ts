import { Router, type Response } from 'express';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import pino from 'pino';
import type { AuthenticatedRequest } from '../types.js';

const log = pino({ name: 'claude-sessions' });

function paramStr(req: AuthenticatedRequest, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

/**
 * Decode Claude project folder name to filesystem path.
 * "C--Users-rbgnr-git-foo" -> "~/git\foo"
 */
function decodeProjectFolder(folder: string): string {
  let result = '';
  let i = 0;
  if (folder.length >= 2 && folder[1] === '-') {
    result += folder[0] + ':';
    i = 2;
  }
  while (i < folder.length) {
    result += folder[i] === '-' ? (os.platform() === 'win32' ? '\\' : '/') : folder[i];
    i++;
  }
  return result;
}

/** Parse a session JSONL file (reads first 50 lines for metadata). */
async function parseSession(filePath: string, projectPath: string, folderName: string) {
  const sessionId = path.basename(filePath, '.jsonl');
  const stat = await fs.promises.stat(filePath);

  let slug = '';
  let cwd = '';
  let firstMessage = '';
  let lineCount = 0;

  const content = await fs.promises.readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  lineCount = lines.filter(l => l.trim()).length;

  // Only parse first 50 lines for metadata
  for (let i = 0; i < Math.min(50, lines.length); i++) {
    if (!lines[i].trim()) continue;
    try {
      const d = JSON.parse(lines[i]);
      if (d.type === 'user' && d.sessionId) {
        if (!slug) slug = d.slug || '';
        if (!cwd) cwd = d.cwd || '';
      }
      if (!firstMessage && d.type === 'user' && d.message?.content) {
        const msgContent = d.message.content;
        if (Array.isArray(msgContent)) {
          const textBlock = msgContent.find((c: any) => c.type === 'text');
          if (textBlock) firstMessage = textBlock.text?.substring(0, 120) || '';
        } else if (typeof msgContent === 'string') {
          firstMessage = msgContent.substring(0, 120);
        }
      }
      if (slug && firstMessage) break;
    } catch {
      // skip malformed lines
    }
  }

  return {
    id: sessionId,
    slug,
    summary: firstMessage,
    cwd,
    messages: lineCount,
    modified: stat.mtime.toISOString(),
    mtime: stat.mtime.getTime(),
    status: 'idle',
    projectPath,
    projectFolder: folderName,
  };
}

export function createClaudeSessionRoutes(): Router {
  const router = Router();

  // GET /api/claude/projects — list all projects with sessions
  router.get('/projects', async (_req: AuthenticatedRequest, res: Response) => {
    try {
      const claudeDir = path.join(os.homedir(), '.claude', 'projects');
      if (!fs.existsSync(claudeDir)) {
        res.json({ ok: true, data: [] });
        return;
      }

      const entries = await fs.promises.readdir(claudeDir, { withFileTypes: true });
      const projects: any[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const name = entry.name;
        // Skip symlinks, memory, non-drive folders
        if (name.startsWith('-') || name === 'memory') continue;
        if (name.length < 3 || name[1] !== '-' || name[2] !== '-') continue;

        const projDir = path.join(claudeDir, name);
        const files = await fs.promises.readdir(projDir);
        const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

        if (jsonlFiles.length === 0) continue;

        const decodedPath = decodeProjectFolder(name);
        const sessions = [];

        // Parse each session (limit to 20 most recent for performance)
        const fileStats = await Promise.all(
          jsonlFiles.map(async f => ({
            name: f,
            mtime: (await fs.promises.stat(path.join(projDir, f))).mtime.getTime(),
          })),
        );
        fileStats.sort((a, b) => b.mtime - a.mtime);

        for (const f of fileStats.slice(0, 20)) {
          try {
            const sess = await parseSession(
              path.join(projDir, f.name), decodedPath, name,
            );
            sessions.push(sess);
          } catch {
            // skip unreadable sessions
          }
        }

        sessions.sort((a, b) => b.mtime - a.mtime);

        projects.push({
          folder: name,
          path: decodedPath,
          sessions,
        });
      }

      // Sort by most recent session
      projects.sort((a, b) => {
        const aMax = a.sessions[0]?.mtime || 0;
        const bMax = b.sessions[0]?.mtime || 0;
        return bMax - aMax;
      });

      res.json({ ok: true, data: projects });
    } catch (err: any) {
      log.error({ err }, 'failed to list claude projects');
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // GET /api/claude/projects/:folder/sessions — sessions for one project
  router.get('/projects/:folder/sessions', async (req: AuthenticatedRequest, res: Response) => {
    try {
      const folder = paramStr(req, 'folder');
      const claudeDir = path.join(os.homedir(), '.claude', 'projects');
      const projDir = path.join(claudeDir, folder);

      if (!fs.existsSync(projDir)) {
        res.status(404).json({ ok: false, error: 'Project not found' });
        return;
      }

      const decodedPath = decodeProjectFolder(folder);
      const files = await fs.promises.readdir(projDir);
      const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));

      const sessions = [];
      for (const f of jsonlFiles) {
        try {
          const sess = await parseSession(
            path.join(projDir, f), decodedPath, folder,
          );
          sessions.push(sess);
        } catch {
          // skip unreadable sessions
        }
      }

      sessions.sort((a, b) => b.mtime - a.mtime);
      res.json({ ok: true, data: sessions });
    } catch (err: any) {
      log.error({ err }, 'failed to list sessions for project');
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // POST /api/claude/sessions/:id/launch — launch in external terminal
  router.post('/sessions/:id/launch', async (req: AuthenticatedRequest, res: Response) => {
    const { cwd, mode } = req.body; // mode: 'resume' | 'continue'
    const sessionId = paramStr(req, 'id');
    const workDir = cwd || os.homedir();

    const claudeCmd = mode === 'continue' ? 'claude --continue' : `claude --resume ${sessionId}`;

    try {
      if (os.platform() === 'win32') {
        // Use cmd.exe /c start to open a new PowerShell window
        execFile('cmd.exe', ['/c', 'start', 'powershell', '-NoExit', '-Command',
          `cd '${workDir}'; ${claudeCmd}`], { windowsHide: false });
      } else {
        execFile('/bin/sh', ['-c', `cd '${workDir}' && ${claudeCmd} &`]);
      }
      res.json({ ok: true });
    } catch (err: any) {
      log.error({ err }, 'failed to launch claude session');
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}
