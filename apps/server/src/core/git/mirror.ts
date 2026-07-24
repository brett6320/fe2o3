import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

export interface MirrorConfig {
  url: string;
  branch: string;
  /** HTTPS personal access token (for https:// remotes). */
  token?: string | undefined;
  /** SSH private key PEM (for git@/ssh:// remotes). */
  sshKey?: string | undefined;
}

/** Embed a token into an https URL as `https://x-access-token:<token>@host/…`. */
function tokenizeUrl(url: string, token: string): string {
  const u = new URL(url);
  u.username = 'x-access-token';
  u.password = token;
  return u.toString();
}

/**
 * Force-push the local org repo to its external mirror. The fe2o3 repo is the
 * source of truth, so the mirror is overwritten to stay in sync. Returns void
 * on success and throws with git's stderr on failure (caller logs, never fails
 * the backup).
 */
export async function pushMirror(repoDir: string, cfg: MirrorConfig): Promise<void> {
  const isSsh = cfg.url.startsWith('git@') || cfg.url.startsWith('ssh://');
  let keyDir: string | undefined;
  const env: NodeJS.ProcessEnv = {
    GIT_TERMINAL_PROMPT: '0', // never hang waiting for interactive credentials
  };
  let pushUrl = cfg.url;

  try {
    if (isSsh && cfg.sshKey) {
      keyDir = await mkdtemp(join(tmpdir(), 'fe2o3-mirror-'));
      const keyFile = join(keyDir, 'id');
      await writeFile(keyFile, cfg.sshKey.endsWith('\n') ? cfg.sshKey : `${cfg.sshKey}\n`);
      await chmod(keyFile, 0o600);
      env.GIT_SSH_COMMAND = `ssh -i ${keyFile} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/dev/null`;
    } else if (!isSsh && cfg.token) {
      pushUrl = tokenizeUrl(cfg.url, cfg.token);
    }

    await execa('git', ['push', '--force', pushUrl, `HEAD:refs/heads/${cfg.branch}`], {
      cwd: repoDir,
      env,
      timeout: 60_000,
    });
  } finally {
    if (keyDir) await rm(keyDir, { recursive: true, force: true });
  }
}
