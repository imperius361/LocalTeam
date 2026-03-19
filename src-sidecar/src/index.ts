import { createInterface } from 'node:readline';
import { encodeMessage, decodeMessage, type IpcRequest, type IpcResponse } from './protocol.js';

const rl = createInterface({ input: process.stdin });

function handleRequest(req: IpcRequest): IpcResponse {
  switch (req.method) {
    case 'ping':
      return { id: req.id, result: { status: 'pong' } };
    case 'echo':
      return { id: req.id, result: req.params };
    default:
      return {
        id: req.id,
        error: { code: -1, message: `Unknown method: ${req.method}` },
      };
  }
}

rl.on('line', (line) => {
  try {
    const req = decodeMessage(line) as IpcRequest;
    const res = handleRequest(req);
    process.stdout.write(encodeMessage(res));
  } catch (err) {
    const errorRes: IpcResponse = {
      id: 'unknown',
      error: { code: -2, message: err instanceof Error ? err.message : 'Unknown error' },
    };
    process.stdout.write(encodeMessage(errorRes));
  }
});

process.stderr.write('localteam-sidecar started\n');
