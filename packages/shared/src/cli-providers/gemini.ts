import type { CliProvider, CliCommandOptions } from './types.js';

export const geminiProvider: CliProvider = {
  id: 'gemini',
  displayName: 'Gemini',
  binary: 'gemini',
  skipPermissionsFlag: '--yolo',
  resumeFlag: null,
  forkFlag: null,
  supportsResume: false,
  supportsFork: false,
  projectsDir: '.gemini',
  sessionFileExt: '.json',

  buildCommand(opts: CliCommandOptions): string {
    let cmd = 'gemini';
    if (opts.skipPermissions) cmd += ' --yolo';
    if (opts.extraArgs) cmd += ` ${opts.extraArgs}`;
    if (opts.wslHome) cmd = `HOME="${opts.wslHome}" ${cmd}`;
    return cmd;
  },

  encodeFolderName(workspacePath: string): string {
    return workspacePath;
  },

  decodeFolderName(folderName: string): string {
    return folderName;
  },
};
