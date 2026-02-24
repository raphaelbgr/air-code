import { readdir, readFile, stat, access } from 'node:fs/promises';
import { join, basename, resolve } from 'node:path';
import { homedir } from 'node:os';
import pino from 'pino';
import type { DetectedWorkspace } from '@claude-air/shared';
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
}

interface SessionsIndex {
  version: number;
  entries: SessionEntry[];
}

interface ClaudeProjectEntry {
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
 * Decode a Claude projects folder name back to the original filesystem path.
 * Claude encodes paths as: C:\Users\foo -> C--Users-foo
 */
function decodeFolderName(folderName: string): string {
  const match = folderName.match(/^([A-Za-z])--(.*)$/);
  if (!match) return folderName;
  const drive = match[1].toUpperCase();
  const rest = match[2].replace(/-/g, '\\');
  return `${drive}:\\${rest}`;
}

/**
 * Encode a filesystem path to Claude's folder name format.
 * C:\Users\rbgnr\git\Stream-Lens -> C--Users-rbgnr-git-Stream-Lens
 */
export function encodeFolderName(fsPath: string): string {
  const match = fsPath.match(/^([A-Za-z]):\\(.*)$/);
  if (!match) return fsPath;
  return `${match[1]}--${match[2].replace(/\\/g, '-')}`;
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
 * Scan all Claude project entries from ~/.claude/projects/.
 * Shared core logic used by both detectFromClaudeProjects and getClaudeStatsMap.
 */
async function scanClaudeProjectEntries(): Promise<ClaudeProjectEntry[]> {
  const projectsDir = join(homedir(), '.claude', 'projects');
  const results: ClaudeProjectEntry[] = [];

  let entries: string[];
  try {
    entries = await readdir(projectsDir);
  } catch {
    log.warn({ projectsDir }, 'Could not read Claude projects directory');
    return [];
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

    const indexPath = join(entryPath, 'sessions-index.json');
    let projectPath: string | null = null;
    let sessionCount = 0;
    let lastActive = '';

    try {
      const raw = await readFile(indexPath, 'utf-8');
      const index: SessionsIndex = JSON.parse(raw);

      if (index.entries?.length) {
        for (const e of index.entries) {
          if (e.projectPath) {
            projectPath = e.projectPath;
            break;
          }
        }
        sessionCount = index.entries.length;
        lastActive = index.entries.reduce((latest, e) =>
          e.modified > latest ? e.modified : latest, '');
      }
    } catch {
      // No sessions-index.json — count .jsonl files directly
      try {
        const dirFiles = await readdir(entryPath);
        const jsonlFiles = dirFiles.filter(f => f.endsWith('.jsonl'));
        sessionCount = jsonlFiles.length;
        if (jsonlFiles.length > 0) {
          // Use the most recent file's mtime as lastActive
          let latestMtime = 0;
          for (const f of jsonlFiles) {
            try {
              const s = await stat(join(entryPath, f));
              if (s.mtimeMs > latestMtime) latestMtime = s.mtimeMs;
            } catch { /* skip */ }
          }
          if (latestMtime > 0) lastActive = new Date(latestMtime).toISOString();
        }
      } catch { /* skip */ }
    }

    if (!projectPath) {
      projectPath = decodeFolderName(entry);
    }

    results.push({ projectPath, sessionCount, lastActive });
  }

  return results;
}

/**
 * Detect workspaces from ~/.claude/projects/ session indexes.
 */
async function detectFromClaudeProjects(existingPaths: Set<string>): Promise<DetectedWorkspace[]> {
  const entries = await scanClaudeProjectEntries();
  return entries.map((e) => ({
    path: e.projectPath,
    name: basename(e.projectPath),
    sessionCount: e.sessionCount,
    lastActive: e.lastActive,
    alreadyImported: existingPaths.has(normalizePath(e.projectPath)),
  }));
}

// Cache for getClaudeStatsMap to avoid filesystem reads on every 5s poll
let _statsCache: Map<string, { sessionCount: number; lastActive: string }> | null = null;
let _statsCacheTime = 0;
const STATS_CACHE_TTL = 30_000; // 30 seconds

/**
 * Build a map of workspace path to Claude Code session stats.
 * Scans all sessions-index.json files under ~/.claude/projects/ and returns counts + last active dates.
 * Results are cached for 30 seconds to avoid excessive filesystem reads.
 */
export async function getClaudeStatsMap(): Promise<Map<string, { sessionCount: number; lastActive: string }>> {
  if (_statsCache && Date.now() - _statsCacheTime < STATS_CACHE_TTL) {
    return _statsCache;
  }

  const entries = await scanClaudeProjectEntries();
  const result = new Map<string, { sessionCount: number; lastActive: string }>();

  for (const e of entries) {
    if (e.sessionCount > 0) {
      result.set(normalizePath(e.projectPath), { sessionCount: e.sessionCount, lastActive: e.lastActive });
    }
  }

  _statsCache = result;
  _statsCacheTime = Date.now();
  return result;
}

/**
 * Get Claude Code conversation entries for a specific workspace path.
 * Always scans .jsonl files directly — sessions-index.json is deprecated since Claude Code v2.1.31
 * and is often stale/incomplete. JSONL scanning is the same approach Claude Code itself uses.
 */
export async function getClaudeSessionsForPath(workspacePath: string): Promise<SessionEntry[]> {
  const folderName = encodeFolderName(workspacePath);
  const projectDir = join(homedir(), '.claude', 'projects', folderName);
  return scanJsonlSessions(projectDir, workspacePath);
}

/**
 * Parse session info from individual .jsonl files in a project directory.
 * Reads the first few lines of each file to extract sessionId, summary, and message count.
 */
async function scanJsonlSessions(projectDir: string, workspacePath: string): Promise<SessionEntry[]> {
  let files: string[];
  try {
    files = (await readdir(projectDir)).filter(f => f.endsWith('.jsonl'));
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

      if (!sessionId) sessionId = file.replace('.jsonl', '');
      if (!firstPrompt) firstPrompt = 'Untitled conversation';

      results.push({
        sessionId,
        summary: firstPrompt,
        messageCount: userCount,
        created: created || fileStat.mtime.toISOString(),
        modified: fileStat.mtime.toISOString(),
        gitBranch,
        projectPath: workspacePath,
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
    // Don't recurse into project subdirectories
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
 * Detect workspaces. Combines Claude projects registry with optional directory scan.
 */
export async function detectWorkspaces(scanDir?: string): Promise<DetectedWorkspace[]> {
  const existingPaths = getExistingPaths();

  // Always include Claude projects
  const claudeResults = await detectFromClaudeProjects(existingPaths);

  // Optionally scan a directory
  let scanResults: DetectedWorkspace[] = [];
  if (scanDir) {
    log.info({ scanDir }, 'scanning directory for projects');
    scanResults = await scanDirectory(scanDir, existingPaths);
  }

  // Merge and deduplicate by path (case-insensitive on Windows)
  const seen = new Set<string>();
  const merged: DetectedWorkspace[] = [];

  // Claude projects first (they have session data)
  for (const ws of claudeResults) {
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
