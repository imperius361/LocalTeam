import { describe, it, expect } from 'vitest';
import { handleRequest, createHandlers } from '../src/handlers';
import type { LocalTeamRuntime } from '../src/runtime';

describe('Request Handlers', () => {
  it('responds to ping with pong', () => {
    const res = handleRequest({ id: '1', method: 'ping', params: {} });
    expect(res.result).toEqual({ status: 'pong' });
    expect(res.error).toBeUndefined();
  });

  it('echoes params back', () => {
    const params = { message: 'hello' };
    const res = handleRequest({ id: '2', method: 'echo', params });
    expect(res.result).toEqual(params);
  });

  it('responds to status with sidecar info', () => {
    const res = handleRequest({ id: '3', method: 'status', params: {} });
    expect(res.result).toHaveProperty('uptime');
    expect(res.result).toHaveProperty('version');
  });

  it('returns error for unknown method', () => {
    const res = handleRequest({ id: '4', method: 'nonexistent', params: {} });
    expect(res.error).toBeDefined();
    expect(res.error!.message).toContain('Unknown method');
  });
});

describe('Runtime Handlers', () => {
  function setup() {
    const runtime = {
      status: async () => ({ agentStatuses: [], tasks: [], sidecar: { ready: true } }),
      loadProject: async () => ({ projectRoot: '/tmp/project' }),
      saveProject: async () => ({ ok: true }),
      listTemplates: async () => [{ id: 'default' }],
      getTemplate: async () => ({ teams: [{ id: 'default', name: 'Default', members: [] }] }),
      getNemoclawStatus: async () => ({ gateway: { ready: true }, runtimeProfiles: [] }),
      listRuntimeProfiles: async () => [{ id: 'nemoclaw/local-default' }],
      applyTeam: async () => ({ ok: true }),
      startSession: async () => ({ session: { id: 'session-1' } }),
      stopSession: async () => ({ session: { id: 'session-1', status: 'idle' } }),
      listSessions: async () => [{ id: 'session-1' }],
      observeSession: async () => [{ id: 'event-1' }],
      listApprovals: async () => [{ id: 'approval-1', status: 'pending' }],
      listCommandApprovals: async () => [{ id: 'approval-1', status: 'pending' }],
      resolveApproval: async () => ({ id: 'approval-1', status: 'approved' }),
    } as unknown as LocalTeamRuntime;

    return createHandlers(runtime);
  }

  it('handles v1.nemoclaw.status', async () => {
    const handle = setup();
    const res = await handle({
      id: '1',
      method: 'v1.nemoclaw.status',
      params: {},
    });

    expect(res.error).toBeUndefined();
    expect((res.result as any).gateway.ready).toBe(true);
  });

  it('handles v1.nemoclaw.profiles.list', async () => {
    const handle = setup();
    const res = await handle({ id: '1', method: 'v1.nemoclaw.profiles.list', params: {} });

    expect(res.error).toBeUndefined();
    expect((res.result as any[])).toHaveLength(1);
  });

  it('handles get_agents via runtime snapshot', async () => {
    const handle = setup();
    const res = await handle({ id: '1', method: 'get_agents', params: {} });

    expect(res.error).toBeUndefined();
    expect(res.result).toEqual([]);
  });

  it('handles v1.nemoclaw.team.apply', async () => {
    const handle = setup();
    const res = await handle({
      id: '1',
      method: 'v1.nemoclaw.team.apply',
      params: { teamId: 'default-team' },
    });

    expect(res.error).toBeUndefined();
    expect((res.result as any).ok).toBe(true);
  });

  it('handles v1.session.start', async () => {
    const handle = setup();
    const res = await handle({
      id: '1',
      method: 'v1.session.start',
      params: {},
    });

    expect(res.error).toBeUndefined();
    expect((res.result as any).session.id).toBe('session-1');
  });

  it('handles v1.nemoclaw.session.stop', async () => {
    const handle = setup();
    const res = await handle({
      id: '1',
      method: 'v1.nemoclaw.session.stop',
      params: { sessionId: 'session-1' },
    });

    expect(res.error).toBeUndefined();
    expect((res.result as any).session.status).toBe('idle');
  });

  it('handles v1.nemoclaw.sessions.list', async () => {
    const handle = setup();
    const res = await handle({
      id: '1',
      method: 'v1.nemoclaw.sessions.list',
      params: {},
    });

    expect(res.error).toBeUndefined();
    expect((res.result as any[])).toHaveLength(1);
  });

  it('handles v1.nemoclaw.events.list', async () => {
    const handle = setup();
    const res = await handle({
      id: '1',
      method: 'v1.nemoclaw.events.list',
      params: { sessionId: 'session-1' },
    });

    expect(res.error).toBeUndefined();
    expect((res.result as any[])).toHaveLength(1);
  });

  it('handles v1.nemoclaw.approvals.list', async () => {
    const handle = setup();
    const res = await handle({
      id: '1',
      method: 'v1.nemoclaw.approvals.list',
      params: {},
    });

    expect(res.error).toBeUndefined();
    expect((res.result as any[])).toHaveLength(1);
  });

  it('handles v1.command.approval.list', async () => {
    const handle = setup();
    const res = await handle({
      id: '1',
      method: 'v1.command.approval.list',
      params: {},
    });

    expect(res.error).toBeUndefined();
    expect((res.result as any[])).toHaveLength(1);
  });

  it('handles v1.command.approval.resolve', async () => {
    const handle = setup();
    const res = await handle({
      id: '1',
      method: 'v1.command.approval.resolve',
      params: { approvalId: 'approval-1', action: 'approve' },
    });

    expect(res.error).toBeUndefined();
    expect((res.result as any).status).toBe('approved');
  });
});
