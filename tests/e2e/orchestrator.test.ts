import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sidecarDir = join(__dirname, '..', '..', 'src-sidecar');

let child: ChildProcess;
let rl: ReturnType<typeof createInterface>;

function sendRequest(
  method: string,
  params: Record<string, unknown> = {},
): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = String(Date.now() + Math.random());
    const msg = JSON.stringify({ id, method, params }) + '\n';

    const timeout = setTimeout(() => {
      rl.off('line', handler);
      reject(new Error(`Timeout waiting for response to ${method}`));
    }, 5000);

    const handler = (line: string) => {
      try {
        const parsed = JSON.parse(line);
        if (parsed.id === id) {
          clearTimeout(timeout);
          rl.off('line', handler);
          if (parsed.error) {
            reject(new Error(parsed.error.message));
          } else {
            resolve(parsed.result);
          }
        }
      } catch {
        // Ignore non-JSON lines
      }
    };

    rl.on('line', handler);
    child.stdin!.write(msg);
  });
}

describe('Orchestrator E2E', () => {
  beforeAll(async () => {
    child = spawn('npx', ['tsx', 'src/index.ts'], {
      cwd: sidecarDir,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    rl = createInterface({ input: child.stdout! });

    // Wait for sidecar to start
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
    const task = await sendRequest('create_task', {
      title: 'E2E Test Task',
      description: 'Created from E2E test',
    });

    expect(task.title).toBe('E2E Test Task');
    expect(task.status).toBe('pending');

    const tasks = await sendRequest('list_tasks');
    expect(tasks.length).toBeGreaterThanOrEqual(1);
    expect(tasks.some((t: any) => t.title === 'E2E Test Task')).toBe(true);
  });

  it('returns empty agent list initially', async () => {
    const agents = await sendRequest('get_agents');
    expect(agents).toEqual([]);
  });

  it('returns error for unknown method', async () => {
    await expect(sendRequest('nonexistent')).rejects.toThrow('Unknown method');
  });
});
