import { describe, it, expect } from 'vitest';
import { getCliProvider, DEFAULT_CLI_PROVIDER } from '@air-code/shared';

/**
 * Tests verifying that SessionService command building logic
 * correctly delegates to CLI providers. Since SessionService depends
 * on the DB, tmux, and node-pty, we test the provider layer directly
 * to ensure the command strings are correct.
 */
describe('SessionService command building via providers', () => {
  it('builds Claude command for new tmux session', () => {
    const provider = getCliProvider('claude');
    const cmd = provider.buildCommand({
      skipPermissions: true,
      wslHome: '/mnt/c/Users/rbgnr',
    });
    expect(cmd).toBe('HOME="/mnt/c/Users/rbgnr" claude --dangerously-skip-permissions');
  });

  it('builds Claude command for resume in tmux', () => {
    const provider = getCliProvider('claude');
    const cmd = provider.buildCommand({
      resumeId: 'session-123',
      skipPermissions: false,
      wslHome: '/mnt/c/Users/rbgnr',
    });
    expect(cmd).toBe('HOME="/mnt/c/Users/rbgnr" claude --resume session-123');
  });

  it('builds Claude command for fork in tmux', () => {
    const provider = getCliProvider('claude');
    const cmd = provider.buildCommand({
      resumeId: 'session-123',
      forkSession: true,
      skipPermissions: true,
      extraArgs: '--model opus',
      wslHome: '/mnt/c/Users/rbgnr',
    });
    expect(cmd).toBe('HOME="/mnt/c/Users/rbgnr" claude --resume session-123 --fork-session --dangerously-skip-permissions --model opus');
  });

  it('builds Claude command for PTY (no wslHome)', () => {
    const provider = getCliProvider('claude');
    const cmd = provider.buildCommand({
      resumeId: 'session-456',
      skipPermissions: true,
    });
    expect(cmd).toBe('claude --resume session-456 --dangerously-skip-permissions');
  });

  it('builds Gemini command for new session', () => {
    const provider = getCliProvider('gemini');
    const cmd = provider.buildCommand({
      skipPermissions: true,
    });
    expect(cmd).toBe('gemini --yolo');
  });

  it('builds Gemini command with wslHome', () => {
    const provider = getCliProvider('gemini');
    const cmd = provider.buildCommand({
      skipPermissions: true,
      wslHome: '/mnt/c/Users/rbgnr',
    });
    expect(cmd).toBe('HOME="/mnt/c/Users/rbgnr" gemini --yolo');
  });

  it('defaults to claude provider', () => {
    const provider = getCliProvider(DEFAULT_CLI_PROVIDER);
    expect(provider.id).toBe('claude');
    expect(provider.binary).toBe('claude');
  });

  it('provider.encodeFolderName used for project dir', () => {
    const claude = getCliProvider('claude');
    const folder = claude.encodeFolderName('~\\git\\claude-air-tmux');
    expect(folder).toBe('C--Users-rbgnr-git-claude-air-tmux');
  });

  it('session file extension is provider-specific', () => {
    expect(getCliProvider('claude').sessionFileExt).toBe('.jsonl');
    expect(getCliProvider('gemini').sessionFileExt).toBe('.json');
  });
});
