import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

function spawnSidecar(): Promise<{
  send: (msg: object) => void;
  receive: () => Promise<object>;
  kill: () => void;
}> {
  return new Promise((resolveReady) => {
    const child = spawn('npx', ['tsx', 'src/index.ts'], {
      cwd: resolve(dirname(fileURLToPath(import.meta.url)), '../../src-sidecar'),
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const responses: string[] = [];
    let waitingResolve: ((value: object) => void) | null = null;

    child.stdout!.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        if (waitingResolve) {
          waitingResolve(JSON.parse(line));
          waitingResolve = null;
        } else {
          responses.push(line);
        }
      }
    });

    // Wait for stderr "started" message
    child.stderr!.on('data', () => {
      resolveReady({
        send: (msg: object) => {
          child.stdin!.write(JSON.stringify(msg) + '\n');
        },
        receive: () =>
          new Promise<object>((res) => {
            const existing = responses.shift();
            if (existing) {
              res(JSON.parse(existing));
            } else {
              waitingResolve = res;
            }
          }),
        kill: () => child.kill(),
      });
    });
  });
}

describe('Sidecar IPC E2E', () => {
  it('ping returns pong', async () => {
    const sidecar = await spawnSidecar();
    try {
      sidecar.send({ id: '1', method: 'ping', params: {} });
      const res = await sidecar.receive();
      expect(res).toEqual({ id: '1', result: { status: 'pong' } });
    } finally {
      sidecar.kill();
    }
  });

  it('echo returns params', async () => {
    const sidecar = await spawnSidecar();
    try {
      sidecar.send({ id: '2', method: 'echo', params: { hello: 'world' } });
      const res = await sidecar.receive();
      expect(res).toEqual({ id: '2', result: { hello: 'world' } });
    } finally {
      sidecar.kill();
    }
  });

  it('unknown method returns error', async () => {
    const sidecar = await spawnSidecar();
    try {
      sidecar.send({ id: '3', method: 'fake', params: {} });
      const res = await sidecar.receive() as any;
      expect(res.error).toBeDefined();
      expect(res.error.message).toContain('Unknown method');
    } finally {
      sidecar.kill();
    }
  });
});
