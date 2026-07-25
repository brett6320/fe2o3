import { mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getOrgRepo } from '../src/core/git/repo.js';

describe('git config diffs stay text (Sarian NUL tolerance)', () => {
  it('commits NUL-bearing config as text and produces a line diff', async () => {
    const reposDir = mkdtempSync(join(tmpdir(), 'fe2o3-repos-'));
    const repo = await getOrgRepo(reposDir, 'acme');

    // Sarian gear emits stray NUL bytes in `config c show` output.
    await repo.commitConfig({
      groupSlug: 'can2501',
      deviceName: 'can2501-digi',
      content: 'eth 0 IPaddr "10.0.0.1"\nuser 0 name "value A"\u0000\nroute 0 descr "x"\n',
      message: 'v1',
    });
    await repo.commitConfig({
      groupSlug: 'can2501',
      deviceName: 'can2501-digi',
      content: 'eth 0 IPaddr "10.0.0.1"\nuser 0 name "value B"\u0000\nroute 0 descr "x"\n',
      message: 'v2',
    });

    const versions = await repo.listVersions('can2501', 'can2501-digi');
    expect(versions).toHaveLength(2);

    const diff = await repo.diff('can2501', 'can2501-digi', versions[1].sha, versions[0].sha);
    // a real line diff, not git's binary fallback
    expect(diff).not.toContain('Binary files');
    expect(diff).toContain('-user 0 name "value A"');
    expect(diff).toContain('+user 0 name "value B"');

    // the committed blob is NUL-free
    const stored = await readFile(join(reposDir, 'acme', 'can2501', 'can2501-digi'), 'utf8');
    expect(stored).not.toContain('\u0000');
  });
});
