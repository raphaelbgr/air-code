import { Router, type Request, type Response } from 'express';
import { readdir } from 'node:fs/promises';
import { resolve, dirname, parse as parsePath } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import type { ApiResponse, BrowseResult, BrowseItem } from '@claude-air/shared';

const SKIP = new Set([
  'node_modules', '$RECYCLE.BIN', 'System Volume Information',
  '$WinREAgent', 'Recovery', 'PerfLogs',
]);

const IS_WINDOWS = process.platform === 'win32';

const DRIVE_TYPE_LABELS: Record<string, string> = {
  '2': 'Removable Disk',
  '3': 'Local Disk',
  '4': 'Network Drive',
  '5': 'CD/DVD Drive',
};

/**
 * List available drives on Windows using wmic.
 * Returns BrowseItem[] with drive letters and descriptions.
 */
function listWindowsDrives(): BrowseItem[] {
  try {
    const raw = execFileSync('wmic', ['logicaldisk', 'get', 'name,description,drivetype', '/format:csv'], {
      encoding: 'utf-8',
      timeout: 5000,
    });
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    // CSV header: Node,Description,DriveType,Name
    const items: BrowseItem[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols.length < 4) continue;
      const description = cols[1] || '';
      const driveType = cols[2] || '';
      const name = cols[3] || '';
      if (!name) continue;
      const typeLabel = DRIVE_TYPE_LABELS[driveType] || '';
      const desc = description || typeLabel || 'Drive';
      items.push({ name, isDir: true, description: desc });
    }
    return items.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export function createBrowseRoutes(): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    try {
      const rawPath = typeof req.body?.path === 'string' ? req.body.path.trim() : '';

      // Special sentinel: list available drives
      if (rawPath === '__drives__') {
        if (!IS_WINDOWS) {
          // On non-Windows, just show filesystem root
          const body: ApiResponse<BrowseResult> = {
            ok: true,
            data: { path: '/', parent: null, items: [] },
          };
          return res.json(body);
        }
        const drives = listWindowsDrives();
        const body: ApiResponse<BrowseResult> = {
          ok: true,
          data: { path: '__drives__', parent: null, items: drives },
        };
        return res.json(body);
      }

      const targetPath = rawPath || homedir();
      const resolved = resolve(targetPath);

      const entries = await readdir(resolved, { withFileTypes: true });

      const items: BrowseItem[] = entries
        .filter((e) => {
          if (!e.isDirectory()) return false;
          if (e.name.startsWith('.')) return false;
          if (SKIP.has(e.name)) return false;
          return true;
        })
        .map((e) => ({ name: e.name, isDir: true }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

      // Determine parent — on Windows, drive root goes to __drives__
      const parsed = parsePath(resolved);
      let parent: string | null;
      if (parsed.root === resolved) {
        parent = IS_WINDOWS ? '__drives__' : null;
      } else {
        parent = dirname(resolved);
      }

      const body: ApiResponse<BrowseResult> = {
        ok: true,
        data: { path: resolved, parent, items },
      };
      res.json(body);
    } catch (err) {
      res.status(400).json({ ok: false, error: String(err) } satisfies ApiResponse<never>);
    }
  });

  return router;
}
