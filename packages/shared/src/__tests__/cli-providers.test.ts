import { describe, it, expect } from 'vitest';
import { getCliProvider, getAllCliProviders, DEFAULT_CLI_PROVIDER } from '../cli-providers/index.js';

describe('CLI Provider Registry', () => {
  it('default provider is claude', () => {
    expect(DEFAULT_CLI_PROVIDER).toBe('claude');
  });

  it('getCliProvider returns claude', () => {
    const p = getCliProvider('claude');
    expect(p.id).toBe('claude');
    expect(p.binary).toBe('claude');
  });

  it('getCliProvider returns gemini', () => {
    const p = getCliProvider('gemini');
    expect(p.id).toBe('gemini');
    expect(p.binary).toBe('gemini');
  });

  it('getCliProvider throws on unknown provider', () => {
    expect(() => getCliProvider('unknown' as any)).toThrow('Unknown CLI provider');
  });

  it('getAllCliProviders returns all providers', () => {
    const all = getAllCliProviders();
    expect(all.length).toBe(2);
    expect(all.map(p => p.id).sort()).toEqual(['claude', 'gemini']);
  });
});

describe('Claude Provider', () => {
  const claude = getCliProvider('claude');

  describe('buildCommand', () => {
    it('basic command', () => {
      expect(claude.buildCommand({})).toBe('claude');
    });

    it('with resume', () => {
      expect(claude.buildCommand({ resumeId: 'abc123' })).toBe('claude --resume abc123');
    });

    it('with resume and fork', () => {
      expect(claude.buildCommand({ resumeId: 'abc123', forkSession: true }))
        .toBe('claude --resume abc123 --fork-session');
    });

    it('fork without resume is ignored', () => {
      expect(claude.buildCommand({ forkSession: true })).toBe('claude');
    });

    it('with skip permissions', () => {
      expect(claude.buildCommand({ skipPermissions: true }))
        .toBe('claude --dangerously-skip-permissions');
    });

    it('with extra args', () => {
      expect(claude.buildCommand({ extraArgs: '--model sonnet' }))
        .toBe('claude --model sonnet');
    });

    it('with all options', () => {
      expect(claude.buildCommand({
        resumeId: 'abc',
        forkSession: true,
        skipPermissions: true,
        extraArgs: '--model opus',
        wslHome: '/mnt/c/Users/test',
      })).toBe('HOME="/mnt/c/Users/test" claude --resume abc --fork-session --dangerously-skip-permissions --model opus');
    });

    it('with wslHome wraps command', () => {
      expect(claude.buildCommand({ wslHome: '/mnt/c/Users/foo' }))
        .toBe('HOME="/mnt/c/Users/foo" claude');
    });
  });

  describe('encodeFolderName', () => {
    it('encodes Windows path', () => {
      expect(claude.encodeFolderName('C:\\Users\\foo\\project'))
        .toBe('C--Users-foo-project');
    });

    it('encodes drive root', () => {
      expect(claude.encodeFolderName('F:\\Raphael\\Backups'))
        .toBe('F--Raphael-Backups');
    });

    it('passes through non-Windows paths', () => {
      expect(claude.encodeFolderName('/home/user/project'))
        .toBe('/home/user/project');
    });
  });

  describe('decodeFolderName', () => {
    it('decodes to Windows path', () => {
      expect(claude.decodeFolderName('C--Users-foo-project'))
        .toBe('C:\\Users\\foo\\project');
    });

    it('passes through non-encoded names', () => {
      expect(claude.decodeFolderName('some-folder'))
        .toBe('some-folder');
    });
  });

  describe('encode/decode round-trip', () => {
    it('round-trips paths without hyphens', () => {
      const paths = [
        'D:\\Projects\\MyApp',
        'F:\\Raphael\\Backups\\Aline',
        '~\\git\\StreamLens',
      ];
      for (const path of paths) {
        const encoded = claude.encodeFolderName(path);
        const decoded = claude.decodeFolderName(encoded);
        expect(decoded).toBe(path);
      }
    });

    it('decode is lossy for paths with hyphens (known limitation)', () => {
      // Hyphens in the original path are indistinguishable from path separators
      // after encoding, so decoding is lossy. This matches the existing behavior.
      const path = '~\\git\\claude-air-tmux';
      const encoded = claude.encodeFolderName(path);
      expect(encoded).toBe('C--Users-rbgnr-git-claude-air-tmux');
      const decoded = claude.decodeFolderName(encoded);
      // Hyphens become backslashes — this is why we prefer encoding (lossless)
      // over decoding (lossy) in workspace detection
      expect(decoded).not.toBe(path);
    });
  });

  it('has correct metadata', () => {
    expect(claude.displayName).toBe('Claude');
    expect(claude.supportsResume).toBe(true);
    expect(claude.supportsFork).toBe(true);
    expect(claude.projectsDir).toBe('.claude/projects');
    expect(claude.sessionFileExt).toBe('.jsonl');
    expect(claude.skipPermissionsFlag).toBe('--dangerously-skip-permissions');
    expect(claude.resumeFlag).toBe('--resume');
    expect(claude.forkFlag).toBe('--fork-session');
  });
});

describe('Gemini Provider', () => {
  const gemini = getCliProvider('gemini');

  describe('buildCommand', () => {
    it('basic command', () => {
      expect(gemini.buildCommand({})).toBe('gemini');
    });

    it('with skip permissions (--yolo)', () => {
      expect(gemini.buildCommand({ skipPermissions: true })).toBe('gemini --yolo');
    });

    it('ignores resume (not supported)', () => {
      expect(gemini.buildCommand({ resumeId: 'abc', forkSession: true })).toBe('gemini');
    });

    it('with extra args', () => {
      expect(gemini.buildCommand({ extraArgs: '--sandbox' })).toBe('gemini --sandbox');
    });

    it('with wslHome', () => {
      expect(gemini.buildCommand({ wslHome: '/mnt/c/Users/foo', skipPermissions: true }))
        .toBe('HOME="/mnt/c/Users/foo" gemini --yolo');
    });
  });

  it('has correct metadata', () => {
    expect(gemini.displayName).toBe('Gemini');
    expect(gemini.supportsResume).toBe(false);
    expect(gemini.supportsFork).toBe(false);
    expect(gemini.projectsDir).toBe('.gemini');
    expect(gemini.sessionFileExt).toBe('.json');
    expect(gemini.skipPermissionsFlag).toBe('--yolo');
    expect(gemini.resumeFlag).toBeNull();
    expect(gemini.forkFlag).toBeNull();
  });

  it('encodeFolderName is passthrough', () => {
    expect(gemini.encodeFolderName('C:\\Users\\foo')).toBe('C:\\Users\\foo');
  });

  it('decodeFolderName is passthrough', () => {
    expect(gemini.decodeFolderName('some-folder')).toBe('some-folder');
  });
});
