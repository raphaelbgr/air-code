export type CliProviderId = 'claude' | 'gemini';

export interface CliCommandOptions {
  resumeId?: string;
  forkSession?: boolean;
  skipPermissions?: boolean;
  extraArgs?: string;
  /** HOME override for WSL environments */
  wslHome?: string;
}

export interface CliProvider {
  readonly id: CliProviderId;
  readonly displayName: string;
  readonly binary: string;
  readonly skipPermissionsFlag: string | null;
  readonly resumeFlag: string | null;
  readonly forkFlag: string | null;
  readonly supportsResume: boolean;
  readonly supportsFork: boolean;
  /** Relative to $HOME, e.g. '.claude/projects' */
  readonly projectsDir: string;
  /** Session file extension, e.g. '.jsonl' */
  readonly sessionFileExt: string;

  buildCommand(opts: CliCommandOptions): string;
  encodeFolderName(workspacePath: string): string;
  decodeFolderName(folderName: string): string;
}
