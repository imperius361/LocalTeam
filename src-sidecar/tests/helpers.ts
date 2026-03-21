import { mkdtemp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function createGitWorkspace(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const result = spawnSync('git', ['init'], {
    cwd: root,
    stdio: 'ignore',
  });

  if (result.status !== 0) {
    throw new Error(`git init failed for ${root}`);
  }

  return root;
}

export async function createAppDataDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}
