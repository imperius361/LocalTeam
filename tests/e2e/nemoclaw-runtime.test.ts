import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sidecarDir = join(__dirname, '..', '..', 'src-sidecar');

let child: ChildProcess;
let workspaceRoot: string;
let appDataDir: string;
const responses: string[] = [];
let waiting:
  | { id: string; resolve: (value: unknown) => void; reject: (error: Error) => void }
  | null = null;

function tryDrainQueue(): void {
  if (!waiting) {
    return;
  }

  for (let index = 0; index < responses.length; index += 1) {
    const line = responses[index];
    try {
      const parsed = JSON.parse(line);
      if (parsed.id === waiting.id) {
        responses.splice(index, 1);
        const active = waiting;
        waiting = null;
        if (parsed.error) {
          active.reject(new Error(parsed.error.message));
        } else {
          active.resolve(parsed.result);
        }
        return;
      }
    } catch {
      continue;
    }
  }
}

function sendRequest(method: string, params: Record<string, unknown> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = String(Date.now() + Math.random());
    const msg = JSON.stringify({ id, method, params }) + '\n';

    const timeout = setTimeout(() => {
      if (waiting?.id === id) {
        waiting = null;
      }
      reject(new Error(`Timeout waiting for response to ${method}`));
    }, 5000);

    waiting = {
      id,
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    };

    tryDrainQueue();
    child.stdin!.write(msg);
  });
}

async function createGitWorkspace(prefix: string): Promise<string> {
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

describe('Nemoclaw runtime E2E', () => {
  beforeAll(async () => {
    workspaceRoot = await createGitWorkspace('localteam-nemoclaw-e2e-');
    appDataDir = await mkdtemp(join(tmpdir(), 'localteam-nemoclaw-app-data-'));
    await writeFile(
      join(workspaceRoot, 'localteam.json'),
      JSON.stringify(
        {
          version: 2,
          defaultTeamId: 'team-a',
          teams: [
            {
              id: 'team-a',
              name: 'Team A',
              workspaceMode: 'shared_project',
              members: [
                {
                  id: 'architect',
                  role: 'Software Architect',
                  runtimeProfileRef: 'profiles/architect',
                  runtimeHint: {
                    provider: 'nemoclaw',
                    model: 'openclaw-local',
                  },
                  systemPrompt: 'Lead the team.',
                },
              ],
            },
            {
              id: 'team-b',
              name: 'Team B',
              workspaceMode: 'shared_project',
              members: [
                {
                  id: 'security',
                  role: 'Security Engineer',
                  runtimeProfileRef: 'profiles/security',
                  runtimeHint: {
                    provider: 'nemoclaw',
                    model: 'openclaw-hosted',
                  },
                  systemPrompt: 'Review the policy.',
                },
              ],
            },
          ],
          sandbox: {
            defaultMode: 'direct',
            useWorktrees: false,
          },
          fileAccess: {
            denyList: ['.env', '.ssh/', 'credentials*'],
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: sidecarDir,
      env: {
        ...process.env,
        LOCALTEAM_APP_DATA_DIR: appDataDir,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdout!.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      responses.push(...lines);
      tryDrainQueue();
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Sidecar start timeout')), 10000);
      child.stderr!.on('data', (data) => {
        if (data.toString().includes('started')) {
          clearTimeout(timeout);
          resolve();
        }
      });
    });

    await sendRequest('v1.project.load', { rootPath: workspaceRoot });
  });

  afterAll(async () => {
    child.kill();
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(appDataDir, { recursive: true, force: true });
  });

  it('applies teams and starts Nemoclaw-backed sessions', async () => {
    const loaded = await sendRequest('v1.project.load', { rootPath: workspaceRoot });
    expect((loaded as any).config.teams).toHaveLength(2);

    const applied = await sendRequest('v1.nemoclaw.team.apply', { teamId: 'team-b' });
    expect((applied as any).session).toBeNull();

    const started = await sendRequest('v1.nemoclaw.session.start', { teamId: 'team-b' });
    expect((started as any).session?.teamId).toBe('team-b');

    const status = await sendRequest('v1.nemoclaw.status');
    expect((status as any).activeTeamId).toBe('team-b');
    expect((status as any).runtimeProfiles).toHaveLength(0);

    const sessions = await sendRequest('v1.nemoclaw.sessions.list');
    expect((sessions as any[])).toHaveLength(1);

    const stopped = await sendRequest('v1.nemoclaw.session.stop', {
      sessionId: (started as any).session.id,
    });
    expect((stopped as any).session?.status).toBe('idle');
  });
});
