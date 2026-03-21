import { createInterface } from 'node:readline';
import {
  decodeMessage,
  emitNotification,
  encodeMessage,
  type IpcRequest,
  type IpcResponse,
} from './protocol.js';
import { createHandlers } from './handlers.js';
import { LocalTeamRuntime } from './runtime.js';

const runtime = new LocalTeamRuntime((notification) => {
  emitNotification(notification.method, notification.params);
});
const handleRequest = createHandlers(runtime);
const rl = createInterface({ input: process.stdin });

rl.on('line', async (line: string) => {
  let requestId = 'unknown';

  try {
    const req = decodeMessage(line) as IpcRequest;
    requestId = req.id;
    const res = await handleRequest(req);
    process.stdout.write(encodeMessage(res));
  } catch (err) {
    const errorRes: IpcResponse = {
      id: requestId,
      error: {
        code: -2,
        message: err instanceof Error ? err.message : 'Unknown error',
      },
    };
    process.stdout.write(encodeMessage(errorRes));
  }
});

process.stderr.write('localteam-sidecar started\n');
