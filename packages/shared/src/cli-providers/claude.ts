import type { CliProvider, CliCommandOptions } from './types.js';

export const claudeProvider: CliProvider = {
  id: 'claude',
  displayName: 'Claude',
  binary: 'claude',
  skipPermissionsFlag: '--dangerously-skip-permissions',
  resumeFlag: '--resume',
  forkFlag: '--fork-session',
  supportsResume: true,
  supportsFork: true,
  projectsDir: '.claude/projects',
  sessionFileExt: '.jsonl',

  buildCommand(opts: CliCommandOptions): string {
    let cmd = 'claude';
    if (opts.resumeId) {
      cmd += ` --resume ${opts.resumeId}`;
      if (opts.forkSession) cmd += ' --fork-session';
    }
    if (opts.skipPermissions) cmd += ' --dangerously-skip-permissions';
    if (opts.extraArgs) cmd += ` ${opts.extraArgs}`;
    if (opts.wslHome) cmd = `HOME="${opts.wslHome}" ${cmd}`;
    return cmd;
  },

  /**
   * Encode a Windows path to Claude's project folder name.
   * C:\Users\foo -> C--Users-foo
   */
  encodeFolderName(workspacePath: string): string {
    const match = workspacePath.match(/^([A-Za-z]):\\(.*)$/);
    if (!match) return workspacePath;
    return `${match[1]}--${match[2].replace(/\\/g, '-')}`;
  },

  /**
   * Decode a Claude project folder name back to the original filesystem path.
   * C--Users-foo -> C:\Users\foo
   */
  decodeFolderName(folderName: string): string {
    const match = folderName.match(/^([A-Za-z])--(.*)$/);
    if (!match) return folderName;
    const drive = match[1].toUpperCase();
    const rest = match[2].replace(/-/g, '\\');
    return `${drive}:\\${rest}`;
  },
};
