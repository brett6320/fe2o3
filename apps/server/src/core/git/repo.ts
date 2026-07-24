import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { execa } from 'execa';
import { type MirrorConfig, pushMirror } from './mirror.js';

/**
 * One git repository per org, working-tree layout `<group_slug>/<device_name>`.
 * All mutations are serialized through a per-repo promise chain.
 */
export class OrgRepo {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(readonly dir: string) {}

  private git(args: string[]) {
    return execa('git', args, { cwd: this.dir });
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => {});
    return next;
  }

  async init() {
    await mkdir(this.dir, { recursive: true });
    try {
      await this.git(['rev-parse', '--git-dir']);
    } catch {
      await this.git(['init', '-b', 'main']);
      await this.git(['config', 'user.name', 'fe2o3']);
      await this.git(['config', 'user.email', 'fe2o3@localhost']);
    }
  }

  /**
   * Write a device config and commit if changed.
   * Returns the new commit sha, or null when nothing changed.
   */
  commitConfig(opts: {
    groupSlug: string;
    deviceName: string;
    content: string;
    message: string;
  }): Promise<string | null> {
    return this.enqueue(async () => {
      const relDir = opts.groupSlug;
      const relPath = join(relDir, opts.deviceName);
      await mkdir(join(this.dir, relDir), { recursive: true });
      const { writeFile } = await import('node:fs/promises');
      await writeFile(join(this.dir, relPath), opts.content, 'utf8');
      await this.git(['add', '--', relPath]);
      const diff = await this.git(['diff', '--cached', '--quiet']).then(
        () => true,
        () => false,
      );
      if (diff) return null; // exit 0 = no staged changes
      await this.git(['commit', '-m', opts.message]);
      const { stdout } = await this.git(['rev-parse', 'HEAD']);
      return stdout.trim();
    });
  }

  /** Rename a device file (device rename / group move), committing the move. */
  moveDevice(opts: {
    fromGroup: string;
    fromName: string;
    toGroup: string;
    toName: string;
  }): Promise<void> {
    return this.enqueue(async () => {
      const from = join(opts.fromGroup, opts.fromName);
      const to = join(opts.toGroup, opts.toName);
      const exists = await this.git(['cat-file', '-e', `HEAD:${from}`]).then(
        () => true,
        () => false,
      );
      if (!exists) return;
      await mkdir(join(this.dir, opts.toGroup), { recursive: true });
      await this.git(['mv', from, to]);
      await this.git(['commit', '-m', `${opts.fromName}: moved to ${to}`]);
    });
  }

  /** Push this repo to its external mirror, serialized with commits. */
  mirror(cfg: MirrorConfig): Promise<void> {
    return this.enqueue(() => pushMirror(this.dir, cfg));
  }

  /** Remove a device file (used when a device/group moves to another org's repo). */
  removeDevice(opts: { groupSlug: string; deviceName: string }): Promise<void> {
    return this.enqueue(async () => {
      const rel = join(opts.groupSlug, opts.deviceName);
      const exists = await this.git(['cat-file', '-e', `HEAD:${rel}`]).then(
        () => true,
        () => false,
      );
      if (!exists) return;
      await this.git(['rm', '--quiet', '--', rel]);
      await this.git(['commit', '-m', `${opts.deviceName}: moved out`]);
    });
  }

  async listVersions(groupSlug: string, deviceName: string, limit = 100) {
    const rel = join(groupSlug, deviceName);
    try {
      const { stdout } = await this.git([
        'log',
        `-${limit}`,
        '--format=%H%x00%aI%x00%s',
        '--follow',
        '--',
        rel,
      ]);
      if (!stdout.trim()) return [];
      return stdout
        .trim()
        .split('\n')
        .map((line) => {
          const [sha, date, subject] = line.split('\0');
          return { sha: sha ?? '', date: date ?? '', subject: subject ?? '' };
        });
    } catch {
      return [];
    }
  }

  async showVersion(groupSlug: string, deviceName: string, sha: string): Promise<string | null> {
    const rel = join(groupSlug, deviceName);
    try {
      const { stdout } = await execa('git', ['show', `${sha}:${rel}`], {
        cwd: this.dir,
        maxBuffer: 50 * 1024 * 1024,
      });
      return stdout;
    } catch {
      return null;
    }
  }

  async diff(
    groupSlug: string,
    deviceName: string,
    fromSha: string,
    toSha: string,
  ): Promise<string> {
    const rel = join(groupSlug, deviceName);
    const { stdout } = await execa('git', ['diff', `${fromSha}..${toSha}`, '--', rel], {
      cwd: this.dir,
      maxBuffer: 50 * 1024 * 1024,
    });
    return stdout;
  }
}

const repoCache = new Map<string, OrgRepo>();

export async function getOrgRepo(reposDir: string, orgSlug: string): Promise<OrgRepo> {
  const dir = join(reposDir, orgSlug);
  let repo = repoCache.get(dir);
  if (!repo) {
    repo = new OrgRepo(dir);
    await repo.init();
    repoCache.set(dir, repo);
  }
  return repo;
}
