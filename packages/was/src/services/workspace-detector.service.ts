import { readdir, readFile, stat, access } from 'node:fs/promises';
import { join, basename, resolve } from 'node:path';
import { homedir } from 'node:os';
import pino from 'pino';
import type { DetectedWorkspace } from '@air-code/shared';
import { getAllCliProviders, getCliProvider } from '@air-code/shared';
import { getDb } from '../db/database.js';

const log = pino({ name: 'workspace-detector' });

const PROJECT_MARKERS = ['.git', 'package.json', 'Cargo.toml', 'go.mod', 'build.gradle', 'pom.xml', 'pyproject.toml', 'setup.py'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv', 'venv', 'target']);
const MAX_SCAN_DEPTH = 3;

const IS_WINDOWS = process.platform === 'win32';

interface SessionEntry {
  sessionId: string;
  summary: string;
  messageCount: number;
  created: string;
  modified: string;
  gitBranch: string;
  projectPath: string;
  diskSize: number;
}

interface CliProjectEntry {
  projectPath: string;
  sessionCount: number;
  lastActive: string;
}

/**
 * Normalize a filesystem path for comparison (case-insensitive on Windows).
 */
function normalizePath(p: string): string {
  return IS_WINDOWS ? p.toLowerCase().replace(/\//g, '\\') : p;
}

/**
 * Encode a filesystem path to the CLI's folder name format.
 * Delegates to the Claude provider for backward compatibility.
 * ~/git\Stream-Lens -> C--Users-rbgnr-git-Stream-Lens
 */
export function encodeFolderName(fsPath: string): string {
  return getCliProvider('claude').encodeFolderName(fsPath);
}

function getExistingPaths(): Set<string> {
  const db = getDb();
  return new Set(
    (db.prepare('SELECT path FROM workspaces WHERE path IS NOT NULL').all() as { path: string }[])
      .map((r) => normalizePath(r.path)),
  );
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Scan all CLI project entries across all registered providers.
 * Iterates each provider's projectsDir and uses provider-specific
 * folder name decoding and session file extensions.
 */
async function scanCliProjectEntries(): Promise<CliProjectEntry[]> {
  const results: CliProjectEntry[] = [];

  for (const provider of getAllCliProviders()) {
    const projectsDir = join(homedir(), provider.projectsDir);
    const ext = provider.sessionFileExt;

    let entries: string[];
    try {
      entries = await readdir(projectsDir);
    } catch {
      // Provider directory doesn't exist yet — skip silently
      continue;
    }

    for (const entry of entries) {
      if (entry.startsWith('-') || entry.startsWith('.')) continue;

      const entryPath = join(projectsDir, entry);
      try {
        const s = await stat(entryPath);
        if (!s.isDirectory()) continue;
      } catch {
        continue;
      }

      let projectPath: string | null = null;
      let sessionCount = 0;
      let lastActive = '';

      // Count session files and extract projectPath from session data.
      try {
        const dirFiles = await readdir(entryPath);
        const sessionFiles = dirFiles.filter(f => f.endsWith(ext));
        sessionCount = sessionFiles.length;

        let latestMtime = 0;
        for (const f of sessionFiles) {
          try {
            const s = await stat(join(entryPath, f));
            if (s.mtimeMs > latestMtime) latestMtime = s.mtimeMs;
          } catch { /* skip */ }

          // Extract real project path from first session file that has a cwd field
          if (!projectPath && ext === '.jsonl') {
            try {
              const raw = await readFile(join(entryPath, f), 'utf-8');
              const lines = raw.split('\n', 10);
              for (const line of lines) {
                if (!line) continue;
                try {
                  const obj = JSON.parse(line);
                  if (obj.cwd) {
                    projectPath = obj.cwd;
                    break;
                  }
                  if (obj.projectPath) {
                    projectPath = obj.projectPath;
                    break;
                  }
                } catch { /* skip malformed lines */ }
              }
            } catch { /* skip unreadable files */ }
          }
        }
        if (latestMtime > 0) lastActive = new Date(latestMtime).toISOString();
      } catch { /* skip */ }

      // Last resort: decode folder name using provider (lossy for paths with hyphens)
      if (!projectPath) {
        projectPath = provider.decodeFolderName(entry);
      }

      results.push({ projectPath, sessionCount, lastActive });
    }
  }

  return results;
}

/**
 * Detect workspaces from ~/.claude/projects/ session indexes.
 */
async function detectFromCliProjects(existingPaths: Set<string>): Promise<DetectedWorkspace[]> {
  const entries = await scanCliProjectEntries();
  return entries.map((e) => ({
    path: e.projectPath,
    name: basename(e.projectPath),
    sessionCount: e.sessionCount,
    lastActive: e.lastActive,
    alreadyImported: existingPaths.has(normalizePath(e.projectPath)),
  }));
}

// Cache for getCliStatsMap to avoid filesystem reads on every 5s poll
let _statsCache: Map<string, { sessionCount: number; lastActive: string }> | null = null;
let _statsCacheTime = 0;
let _statsCacheKey = '';
const STATS_CACHE_TTL = 30_000; // 30 seconds

/**
 * Build a map of workspace path to AI CLI session stats.
 * Accepts known workspace paths and uses encodeFolderName (lossless) to find
 * the matching CLI projects folder — avoids decodeFolderName which is lossy
 * for paths containing hyphens.
 * Results are cached for 30 seconds to avoid excessive filesystem reads.
 */
export async function getCliStatsMap(
  workspacePaths: string[]
): Promise<Map<string, { sessionCount: number; lastActive: string }>> {
  const cacheKey = workspacePaths.join('|');
  if (_statsCache && Date.now() - _statsCacheTime < STATS_CACHE_TTL && _statsCacheKey === cacheKey) {
    return _statsCache;
  }

  const result = new Map<string, { sessionCount: number; lastActive: string }>();

  for (const wsPath of workspacePaths) {
    // Check across all providers
    for (const provider of getAllCliProviders()) {
      const folderName = provider.encodeFolderName(wsPath);
      const folderPath = join(homedir(), provider.projectsDir, folderName);

      try {
        const s = await stat(folderPath);
        if (!s.isDirectory()) continue;
      } catch {
        continue;
      }

      const sessions = await scanSessionFiles(folderPath, wsPath, provider.sessionFileExt);
      if (sessions.length > 0) {
        const key = normalizePath(wsPath);
        const existing = result.get(key);
        const lastActive = sessions[0].modified; // already sorted newest-first
        if (existing) {
          // Merge counts across providers
          result.set(key, {
            sessionCount: existing.sessionCount + sessions.length,
            lastActive: lastActive > existing.lastActive ? lastActive : existing.lastActive,
          });
        } else {
          result.set(key, { sessionCount: sessions.length, lastActive });
        }
      }
    }
  }

  _statsCache = result;
  _statsCacheTime = Date.now();
  _statsCacheKey = cacheKey;
  return result;
}

/**
 * Get AI CLI conversation entries for a specific workspace path.
 * Always scans .jsonl files directly — sessions-index.json is deprecated since AI CLI v2.1.31
 * and is often stale/incomplete. JSONL scanning is the same approach AI CLI itself uses.
 */
export async function getCliSessionsForPath(workspacePath: string): Promise<SessionEntry[]> {
  const allSessions: SessionEntry[] = [];
  for (const provider of getAllCliProviders()) {
    const folderName = provider.encodeFolderName(workspacePath);
    const projectDir = join(homedir(), provider.projectsDir, folderName);
    const sessions = await scanSessionFiles(projectDir, workspacePath, provider.sessionFileExt);
    allSessions.push(...sessions);
  }
  // Sort all sessions across providers by modified date descending
  return allSessions.sort((a, b) => b.modified.localeCompare(a.modified));
}

/**
 * Parse session info from individual session files in a project directory.
 * Reads the first few lines of each file to extract sessionId, summary, and message count.
 */
async function scanSessionFiles(projectDir: string, workspacePath: string, ext = '.jsonl'): Promise<SessionEntry[]> {
  let files: string[];
  try {
    files = (await readdir(projectDir)).filter(f => f.endsWith(ext));
  } catch {
    return [];
  }

  const results: SessionEntry[] = [];

  for (const file of files) {
    const filePath = join(projectDir, file);
    try {
      const fileStat = await stat(filePath);
      const raw = await readFile(filePath, 'utf-8');
      const lines = raw.split('\n').filter(Boolean);

      let sessionId = '';
      let firstPrompt = '';
      let gitBranch = '';
      let userCount = 0;
      let created = '';

      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj.sessionId && !sessionId) sessionId = obj.sessionId;
          if (obj.gitBranch && !gitBranch) gitBranch = obj.gitBranch;
          if (obj.type === 'user') {
            userCount++;
            if (!firstPrompt && obj.message?.content) {
              let content = '';
              if (typeof obj.message.content === 'string') {
                content = obj.message.content;
              } else if (Array.isArray(obj.message.content)) {
                // Content blocks: [{"type":"text","text":"..."},...]
                const textBlock = obj.message.content.find((b: { type: string }) => b.type === 'text');
                content = textBlock?.text || '';
              }
              firstPrompt = content.substring(0, 120).replace(/\n/g, ' ').trim();
            }
            if (!created && obj.timestamp) created = obj.timestamp;
          }
        } catch { /* skip malformed lines */ }
      }

      if (!sessionId) sessionId = file.replace(ext, '');
      if (!firstPrompt) firstPrompt = 'Untitled conversation';

      results.push({
        sessionId,
        summary: firstPrompt,
        messageCount: userCount,
        created: created || fileStat.mtime.toISOString(),
        modified: fileStat.mtime.toISOString(),
        gitBranch,
        projectPath: workspacePath,
        diskSize: fileStat.size,
      });
    } catch {
      // Skip files that can't be read
    }
  }

  // Filter out empty sessions, sort by modified date descending (newest first)
  return results
    .filter(r => r.messageCount > 0)
    .sort((a, b) => b.modified.localeCompare(a.modified));
}

/**
 * Recursively scan a directory for project folders (containing .git, package.json, etc).
 */
async function scanDirectory(dir: string, existingPaths: Set<string>, depth = 0): Promise<DetectedWorkspace[]> {
  if (depth > MAX_SCAN_DEPTH) return [];

  const detected: DetectedWorkspace[] = [];

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  // Check if this directory itself is a project
  let isProject = false;
  for (const marker of PROJECT_MARKERS) {
    if (await exists(join(dir, marker))) {
      isProject = true;
      break;
    }
  }

  if (isProject && depth > 0) {
    const absPath = resolve(dir);
    detected.push({
      path: absPath,
      name: basename(absPath),
      sessionCount: 0,
      lastActive: '',
      alreadyImported: existingPaths.has(normalizePath(absPath)),
    });
    // Don't recurse into matched subdirectories
    return detected;
  }

  // Recurse into subdirectories
  for (const entry of entries) {
    if (entry.startsWith('.') && entry !== '.git') continue;
    if (SKIP_DIRS.has(entry)) continue;

    const childPath = join(dir, entry);
    try {
      const s = await stat(childPath);
      if (!s.isDirectory()) continue;
    } catch {
      continue;
    }

    const children = await scanDirectory(childPath, existingPaths, depth + 1);
    detected.push(...children);
  }

  return detected;
}

/**
 * Detect workspaces. Combines CLI projects registry with optional directory scan.
 */
export async function detectWorkspaces(scanDir?: string): Promise<DetectedWorkspace[]> {
  const existingPaths = getExistingPaths();

  // Always include CLI projects
  const cliResults = await detectFromCliProjects(existingPaths);

  // Optionally scan a directory
  let scanResults: DetectedWorkspace[] = [];
  if (scanDir) {
    log.info({ scanDir }, 'scanning directory for projects');
    scanResults = await scanDirectory(scanDir, existingPaths);
  }

  // Merge and deduplicate by path (case-insensitive on Windows)
  const seen = new Set<string>();
  const merged: DetectedWorkspace[] = [];

  // CLI projects first (they have session data)
  for (const ws of cliResults) {
    const key = normalizePath(ws.path);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(ws);
    }
  }
  // Then scanned projects
  for (const ws of scanResults) {
    const key = normalizePath(ws.path);
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(ws);
    }
  }

  // Sort: projects with sessions first (by recency), then alphabetical
  merged.sort((a, b) => {
    if (a.lastActive && !b.lastActive) return -1;
    if (!a.lastActive && b.lastActive) return 1;
    if (a.lastActive && b.lastActive) return b.lastActive.localeCompare(a.lastActive);
    return a.name.localeCompare(b.name);
  });

  return merged;
}
