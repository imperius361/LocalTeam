import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
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

function sendRequest(
  method: string,
  params: Record<string, unknown> = {},
): Promise<any> {
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

describe('Orchestrator E2E', () => {
  beforeAll(async () => {
    workspaceRoot = await createGitWorkspace('localteam-orchestrator-e2e-');
    appDataDir = await mkdtemp(join(tmpdir(), 'localteam-orchestrator-app-data-'));
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
    await sendRequest('v1.project.save', {
      config: {
        team: {
          name: 'Orchestrator E2E',
          agents: [
            {
              id: 'architect',
              role: 'Software Architect',
              model: 'mock',
              provider: 'mock',
              systemPrompt: 'Lead the discussion.',
              canExecuteCommands: true,
              allowedPaths: ['.'],
            },
          ],
        },
        consensus: {
          maxRounds: 2,
          requiredMajority: 0.5,
        },
        sandbox: {
          defaultMode: 'direct',
          useWorktrees: false,
        },
        fileAccess: {
          denyList: ['.env', '.ssh/', 'credentials*'],
        },
      },
    });
    await sendRequest('v1.session.start');
  });

  afterAll(async () => {
    child.kill();
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(appDataDir, { recursive: true, force: true });
  });

  it('sidecar responds to ping after orchestrator init', async () => {
    const result = await sendRequest('ping');
    expect(result).toEqual({ status: 'pong' });
  });

  it('creates and lists tasks via IPC', async () => {
    const snapshot = await sendRequest('create_task', {
      title: 'E2E Test Task',
      description: 'Created from E2E test',
    });

    expect(snapshot.tasks.some((task: any) => task.title === 'E2E Test Task')).toBe(
      true,
    );

    const tasks = await sendRequest('list_tasks');
    expect(tasks.length).toBeGreaterThanOrEqual(1);
    expect(tasks.some((task: any) => task.title === 'E2E Test Task')).toBe(true);
  });

  it('returns agent list', async () => {
    const agents = await sendRequest('get_agents');
    expect(Array.isArray(agents)).toBe(true);
  });

  it('returns error for unknown method', async () => {
    await expect(sendRequest('nonexistent')).rejects.toThrow('Unknown method');
  });
});
