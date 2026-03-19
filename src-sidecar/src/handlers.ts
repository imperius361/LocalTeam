import type { IpcRequest, IpcResponse } from './protocol.js';

const startTime = Date.now();

export function handleRequest(req: IpcRequest): IpcResponse {
  switch (req.method) {
    case 'ping':
      return { id: req.id, result: { status: 'pong' } };

    case 'echo':
      return { id: req.id, result: req.params };

    case 'status':
      return {
        id: req.id,
        result: {
          uptime: Date.now() - startTime,
          version: '0.1.0',
        },
      };

    default:
      return {
        id: req.id,
        error: { code: -1, message: `Unknown method: ${req.method}` },
      };
  }
}
