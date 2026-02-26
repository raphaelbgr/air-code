# Workspace Detection & Claude Code Integration

## Overview

Air Code discovers workspaces from Claude Code's local project data or by browsing the server filesystem, imports them into the canvas, and provides session counts and quick-launch buttons.

## ~/.claude/projects/ Structure

Claude Code stores project session data in `~/.claude/projects/`. Each project folder is named using an encoded version of the filesystem path:

```
~/.claude/projects/
  C--Users-rbgnr-git-stream-lens/
    sessions-index.json
    memory/
    <session-uuid>.jsonl
  C--Users-rbgnr-git-claude-air-tmux/
    sessions-index.json
    ...
```

### Folder Name Encoding

| Original Path | Encoded Folder Name |
|---|---|
| `C:\Users\rbgnr\git\stream-lens` | `C--Users-rbgnr-git-stream-lens` |

Rules:
- Drive letter `C:` becomes `C-` (letter + single dash)
- All `\` separators become `-`
- Result: `C--Users-...` (double dash after drive letter because `:\` becomes `-`)

### sessions-index.json

```json
{
  "version": 1,
  "entries": [
    {
      "sessionId": "abc123-...",
      "summary": "Added workspace detection",
      "messageCount": 42,
      "created": "2026-02-20T10:00:00.000Z",
      "modified": "2026-02-20T11:30:00.000Z",
      "gitBranch": "main",
      "projectPath": "C:\\Users\\rbgnr\\git\\stream-lens"
    }
  ]
}
```

Key fields:
- `entries[].projectPath` — the original filesystem path (used for matching)
- `entries[].modified` — used to determine "last active" time
- `entries.length` — the Claude Code session (chat) count

## Workspace Detection Flow

1. `GET /api/workspaces/detect` triggers `detectWorkspaces()` in `workspace-detector.service.ts`
2. It scans `~/.claude/projects/*/sessions-index.json`
3. For each project folder, it extracts the path (from `entries[].projectPath` or by decoding the folder name)
4. Returns `DetectedWorkspace[]` with `path`, `name`, `sessionCount`, `lastActive`, `alreadyImported`
5. The user selects workspaces to import via the Detect Workspaces dialog
6. `POST /api/workspaces/import` saves them to the database

## Claude Code Session Stats

The `GET /api/workspaces` list endpoint enriches each workspace with:
- `claudeSessionCount` — number of historical Claude Code conversations
- `claudeLastActive` — ISO timestamp of the most recent conversation

This is done by calling `getClaudeStatsMap()` which builds a `Map<path, stats>` from all `sessions-index.json` files, then merging the stats into each workspace that has a matching `path`.

## "Open Claude Code" Flow

1. User clicks the Terminal icon button on a workspace bubble
2. Frontend calls `api.sessions.create({ name, workspacePath })`
3. WAS proxies to SMS which creates a tmux session running `claude` in the workspace directory
4. The new session appears inside the workspace bubble on the canvas
5. User can click the session node to open the terminal panel

## Folder Browser

The "Add Workspace" dialog also provides a folder browser for directly importing any directory:

1. `POST /api/workspaces/browse` returns `BrowseResult` with subdirectories
2. Breadcrumb navigation with drive root ("This PC") and home shortcuts
3. "Add as Workspace" button imports the currently browsed directory
4. Supports Windows drive listing via `__drives__` special path

## Session-Workspace Mapping

Sessions are matched to workspaces by comparing `session.workspacePath === workspace.path`. Sessions that don't match any workspace appear as standalone nodes on the canvas.
