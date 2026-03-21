import type { IpcRequest, IpcResponse } from './protocol.js';
import type { LocalTeamRuntime } from './runtime.js';

const startTime = Date.now();

export function createHandlers(
  runtime: LocalTeamRuntime,
): (req: IpcRequest) => Promise<IpcResponse> {
  return async (req: IpcRequest): Promise<IpcResponse> => {
    switch (req.method) {
      case 'ping':
        return { id: req.id, result: { status: 'pong' } };
      case 'echo':
        return { id: req.id, result: req.params };
      case 'status':
        return {
          id: req.id,
          result: { uptime: Date.now() - startTime, version: '0.2.0' },
        };
      case 'v1.status':
        return { id: req.id, result: await runtime.status() };
      case 'v1.project.load':
        return {
          id: req.id,
          result: await runtime.loadProject(
            typeof req.params.rootPath === 'string' && req.params.rootPath.trim()
              ? req.params.rootPath
              : undefined,
          ),
        };
      case 'v1.project.save':
        return {
          id: req.id,
          result: await runtime.saveProject(req.params.config as any),
        };
      case 'v1.templates.list':
        return { id: req.id, result: await runtime.listTemplates() };
      case 'v1.templates.get':
        return { id: req.id, result: await runtime.getTemplate(String(req.params.id)) };
      case 'v1.credentials.sync':
        return {
          id: req.id,
          result: await runtime.syncCredentials((req.params.values ?? {}) as any),
        };
      case 'v1.session.start':
        return { id: req.id, result: await runtime.startSession() };
      case 'v1.session.snapshot':
        return { id: req.id, result: await runtime.status() };
      case 'create_task':
      case 'v1.task.create': {
        const { title, description } = req.params;
        if (typeof title !== 'string' || !title) {
          return {
            id: req.id,
            error: { code: -3, message: 'Missing required param: title' },
          };
        }
        if (typeof description !== 'string') {
          return {
            id: req.id,
            error: { code: -3, message: 'Missing required param: description' },
          };
        }
        return {
          id: req.id,
          result: await runtime.createTask(
            title,
            description,
            typeof req.params.parentTaskId === 'string'
              ? req.params.parentTaskId
              : undefined,
          ),
        };
      }
      case 'v1.task.interject': {
        if (typeof req.params.taskId !== 'string' || !req.params.taskId) {
          return {
            id: req.id,
            error: { code: -3, message: 'Missing required param: taskId' },
          };
        }
        if (typeof req.params.guidance !== 'string' || !req.params.guidance.trim()) {
          return {
            id: req.id,
            error: { code: -3, message: 'Missing required param: guidance' },
          };
        }
        return {
          id: req.id,
          result: await runtime.interjectTask(req.params.taskId, req.params.guidance),
        };
      }
      case 'v1.task.review.respond': {
        if (typeof req.params.taskId !== 'string' || !req.params.taskId) {
          return {
            id: req.id,
            error: { code: -3, message: 'Missing required param: taskId' },
          };
        }
        if (
          req.params.action !== 'approve' &&
          req.params.action !== 'modify' &&
          req.params.action !== 'reject'
        ) {
          return {
            id: req.id,
            error: {
              code: -3,
              message: 'Invalid param: action must be approve|modify|reject',
            },
          };
        }
        if (
          req.params.action === 'modify' &&
          (typeof req.params.guidance !== 'string' || !req.params.guidance.trim())
        ) {
          return {
            id: req.id,
            error: { code: -3, message: 'Missing required param: guidance' },
          };
        }
        return {
          id: req.id,
          result: await runtime.respondToTaskReview(
            req.params.taskId,
            req.params.action,
            typeof req.params.guidance === 'string' ? req.params.guidance : undefined,
          ),
        };
      }
      case 'list_tasks':
      case 'v1.task.list':
        return { id: req.id, result: await runtime.listTasks() };
      case 'v1.messages.list':
        return {
          id: req.id,
          result: await runtime.listMessages(
            typeof req.params.taskId === 'string' ? req.params.taskId : undefined,
          ),
        };
      case 'v1.command.execute': {
        if (typeof req.params.taskId !== 'string' || !req.params.taskId) {
          return {
            id: req.id,
            error: { code: -3, message: 'Missing required param: taskId' },
          };
        }
        if (typeof req.params.agentId !== 'string' || !req.params.agentId) {
          return {
            id: req.id,
            error: { code: -3, message: 'Missing required param: agentId' },
          };
        }
        if (typeof req.params.command !== 'string' || !req.params.command.trim()) {
          return {
            id: req.id,
            error: { code: -3, message: 'Missing required param: command' },
          };
        }

        return {
          id: req.id,
          result: await runtime.requestCommandExecution({
            taskId: req.params.taskId,
            agentId: req.params.agentId,
            command: req.params.command,
            cwd: typeof req.params.cwd === 'string' ? req.params.cwd : undefined,
          }),
        };
      }
      case 'v1.command.approval.resolve': {
        if (typeof req.params.approvalId !== 'string' || !req.params.approvalId) {
          return {
            id: req.id,
            error: { code: -3, message: 'Missing required param: approvalId' },
          };
        }
        if (req.params.action !== 'approve' && req.params.action !== 'deny') {
          return {
            id: req.id,
            error: { code: -3, message: 'Invalid param: action must be approve|deny' },
          };
        }
        return {
          id: req.id,
          result: await runtime.resolveCommandApproval(
            req.params.approvalId,
            req.params.action,
          ),
        };
      }
      case 'v1.command.approval.list':
        return {
          id: req.id,
          result: await runtime.listCommandApprovals(
            typeof req.params.taskId === 'string' ? req.params.taskId : undefined,
          ),
        };
      case 'v1.consensus.resolve':
        return {
          id: req.id,
          result: await runtime.resolveConsensus(
            String(req.params.taskId),
            req.params.action as 'continue' | 'override' | 'approve_majority',
            typeof req.params.overrideMessage === 'string'
              ? req.params.overrideMessage
              : undefined,
          ),
        };
      case 'get_agents':
        return {
          id: req.id,
          result: (await runtime.status()).agentStatuses,
        };
      default:
        return {
          id: req.id,
          error: { code: -1, message: `Unknown method: ${req.method}` },
        };
    }
  };
}

export function handleRequest(req: IpcRequest): IpcResponse {
  switch (req.method) {
    case 'ping':
      return { id: req.id, result: { status: 'pong' } };
    case 'echo':
      return { id: req.id, result: req.params };
    case 'status':
      return {
        id: req.id,
        result: { uptime: Date.now() - startTime, version: '0.2.0' },
      };
    default:
      return {
        id: req.id,
        error: { code: -1, message: `Unknown method: ${req.method}` },
      };
  }
}
