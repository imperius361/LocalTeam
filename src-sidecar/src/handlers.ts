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
      case 'v1.nemoclaw.status':
        return { id: req.id, result: await runtime.getNemoclawStatus() };
      case 'v1.nemoclaw.profiles.list':
        return { id: req.id, result: await runtime.listRuntimeProfiles() };
      case 'v1.nemoclaw.team.apply':
        return {
          id: req.id,
          result: await runtime.applyTeam(
            typeof req.params.teamId === 'string' ? req.params.teamId : undefined,
          ),
        };
      case 'v1.nemoclaw.session.start':
      case 'v1.session.start':
        return {
          id: req.id,
          result: await runtime.startSession(
            typeof req.params.teamId === 'string' ? req.params.teamId : undefined,
          ),
        };
      case 'v1.nemoclaw.session.stop':
      case 'v1.session.stop':
        return {
          id: req.id,
          result: await runtime.stopSession(
            typeof req.params.sessionId === 'string' ? req.params.sessionId : undefined,
          ),
        };
      case 'v1.nemoclaw.sessions.list':
        return { id: req.id, result: await runtime.listSessions() };
      case 'v1.nemoclaw.events.list':
        return {
          id: req.id,
          result: await runtime.observeSession(
            typeof req.params.sessionId === 'string' ? req.params.sessionId : undefined,
          ),
        };
      case 'v1.nemoclaw.approvals.list':
        return { id: req.id, result: await runtime.listApprovals() };
      case 'v1.command.approval.list':
        return {
          id: req.id,
          result: await runtime.listCommandApprovals(
            typeof req.params.taskId === 'string' ? req.params.taskId : undefined,
          ),
        };
      case 'v1.command.approval.resolve':
        return {
          id: req.id,
          result: await runtime.resolveApproval(
            String(req.params.approvalId),
            req.params.action === 'deny' ? 'deny' : 'approve',
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
