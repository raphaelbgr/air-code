import { describe, it, expect } from 'vitest';
import { getAllCliProviders, getCliProvider } from '@air-code/shared';
import { encodeFolderName } from '../services/workspace-detector.service.js';

describe('workspace-detector provider integration', () => {
  it('encodeFolderName delegates to claude provider', () => {
    const result = encodeFolderName('~\\git\\Stream-Lens');
    const expected = getCliProvider('claude').encodeFolderName('~\\git\\Stream-Lens');
    expect(result).toBe(expected);
    expect(result).toBe('C--Users-rbgnr-git-Stream-Lens');
  });

  it('all providers have unique projectsDir', () => {
    const dirs = getAllCliProviders().map(p => p.projectsDir);
    expect(new Set(dirs).size).toBe(dirs.length);
  });

  it('all providers have unique sessionFileExt or projectsDir', () => {
    const providers = getAllCliProviders();
    // At minimum, projectsDir should be unique to avoid collision
    const dirs = providers.map(p => p.projectsDir);
    expect(new Set(dirs).size).toBe(dirs.length);
  });

  it('claude provider scans .claude/projects', () => {
    const claude = getCliProvider('claude');
    expect(claude.projectsDir).toBe('.claude/projects');
    expect(claude.sessionFileExt).toBe('.jsonl');
  });

  it('gemini provider scans .gemini', () => {
    const gemini = getCliProvider('gemini');
    expect(gemini.projectsDir).toBe('.gemini');
    expect(gemini.sessionFileExt).toBe('.json');
  });

  it('encodeFolderName handles paths with hyphens', () => {
    // Known lossy case: hyphens in path become indistinguishable from separators
    const result = encodeFolderName('C:\\my-project\\src');
    expect(result).toBe('C--my-project-src');
  });

  it('all provider decodeFolderName are callable', () => {
    for (const provider of getAllCliProviders()) {
      // Should not throw
      const result = provider.decodeFolderName('test-folder');
      expect(typeof result).toBe('string');
    }
  });
});
