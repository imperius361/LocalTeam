import type { IpcRequest, IpcResponse } from './protocol.js';
import type { Orchestrator } from './orchestrator.js';
import type { TaskManager } from './task-manager.js';

const startTime = Date.now();

export function createHandlers(
  orchestrator: Orchestrator,
  taskManager: TaskManager,
): (req: IpcRequest) => IpcResponse {
  return (req: IpcRequest): IpcResponse => {
    switch (req.method) {
      case 'ping':
        return { id: req.id, result: { status: 'pong' } };
      case 'echo':
        return { id: req.id, result: req.params };
      case 'status':
        return {
          id: req.id,
          result: { uptime: Date.now() - startTime, version: '0.1.0' },
        };
      case 'create_task': {
        const { title, description } = req.params;
        if (typeof title !== 'string' || !title) {
          return { id: req.id, error: { code: -3, message: 'Missing required param: title' } };
        }
        if (typeof description !== 'string') {
          return { id: req.id, error: { code: -3, message: 'Missing required param: description' } };
        }
        return { id: req.id, result: taskManager.create(title, description) };
      }
      case 'list_tasks':
        return {
          id: req.id,
          result: taskManager.list(req.params.status as any),
        };
      case 'get_agents':
        return {
          id: req.id,
          result: orchestrator.getAgents().map((a) => ({
            id: a.id,
            role: a.role,
            model: a.model,
          })),
        };
      default:
        return {
          id: req.id,
          error: { code: -1, message: `Unknown method: ${req.method}` },
        };
    }
  };
}

// Backward compatibility for existing tests
export function handleRequest(req: IpcRequest): IpcResponse {
  switch (req.method) {
    case 'ping':
      return { id: req.id, result: { status: 'pong' } };
    case 'echo':
      return { id: req.id, result: req.params };
    case 'status':
      return {
        id: req.id,
        result: { uptime: Date.now() - startTime, version: '0.1.0' },
      };
    default:
      return {
        id: req.id,
        error: { code: -1, message: `Unknown method: ${req.method}` },
      };
  }
}
