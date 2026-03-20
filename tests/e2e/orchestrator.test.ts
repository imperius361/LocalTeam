import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sidecarDir = join(__dirname, '..', '..', 'src-sidecar');

let child: ChildProcess;
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

describe('Orchestrator E2E', () => {
  beforeAll(async () => {
    child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: sidecarDir,
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
  });

  afterAll(() => {
    child.kill();
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
