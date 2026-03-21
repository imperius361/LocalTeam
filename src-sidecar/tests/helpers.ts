import { mkdtemp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalizeWorkspacePath } from '../src/workspace-path';

export async function createGitWorkspace(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const initResult = spawnSync('git', ['init'], {
    cwd: root,
    stdio: 'ignore',
  });

  if (initResult.status !== 0) {
    throw new Error(`git init failed for ${root}`);
  }

  const topLevelResult = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: root,
    encoding: 'utf8',
  });

  if (topLevelResult.status !== 0) {
    throw new Error(`git rev-parse failed for ${root}`);
  }

  const topLevel = topLevelResult.stdout.trim();
  if (!topLevel) {
    throw new Error(`git rev-parse returned an empty workspace root for ${root}`);
  }

  return canonicalizeWorkspacePath(topLevel);
}

export async function createAppDataDir(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  return canonicalizeWorkspacePath(root);
}
