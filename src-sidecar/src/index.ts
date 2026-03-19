import { createInterface } from 'node:readline';
import {
  encodeMessage,
  decodeMessage,
  type IpcRequest,
  type IpcResponse,
} from './protocol.js';
import { createHandlers } from './handlers.js';
import { MessageBus } from './message-bus.js';
import { Orchestrator } from './orchestrator.js';
import { TaskManager } from './task-manager.js';

const messageBus = new MessageBus();
const orchestrator = new Orchestrator(messageBus);
const taskManager = new TaskManager();
const handleRequest = createHandlers(orchestrator, taskManager);

const rl = createInterface({ input: process.stdin });

rl.on('line', (line) => {
  try {
    const req = decodeMessage(line) as IpcRequest;
    const res = handleRequest(req);
    process.stdout.write(encodeMessage(res));
  } catch (err) {
    const errorRes: IpcResponse = {
      id: 'unknown',
      error: {
        code: -2,
        message: err instanceof Error ? err.message : 'Unknown error',
      },
    };
    process.stdout.write(encodeMessage(errorRes));
  }
});

process.stderr.write('localteam-sidecar started\n');
