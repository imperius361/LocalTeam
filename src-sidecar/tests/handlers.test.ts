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
      status: async () => ({ agentStatuses: [], tasks: [] }),
      loadProject: async () => ({ projectRoot: '/tmp/project' }),
      saveProject: async () => ({ ok: true }),
      listTemplates: async () => [{ id: 'default' }],
      getTemplate: async () => ({ team: { name: 'Default', agents: [] } }),
      syncCredentials: async () => [{ provider: 'openai', hasKey: true }],
      startSession: async () => ({ session: { id: 'session-1' } }),
      createTask: async (title: string) => ({
        tasks: [{ id: 'task-1', title, status: 'pending' }],
      }),
      listTasks: async () => [{ id: 'task-1' }],
      listMessages: async () => [{ id: 'msg-1' }],
      resolveConsensus: async () => ({ consensus: [] }),
    } as unknown as LocalTeamRuntime;

    return createHandlers(runtime);
  }

  it('handles v1.task.create', async () => {
    const handle = setup();
    const res = await handle({
      id: '1',
      method: 'v1.task.create',
      params: { title: 'Build auth', description: 'OAuth2 login' },
    });

    expect(res.error).toBeUndefined();
    expect((res.result as any).tasks[0].title).toBe('Build auth');
  });

  it('handles v1.task.list', async () => {
    const handle = setup();
    const res = await handle({ id: '1', method: 'v1.task.list', params: {} });

    expect(res.error).toBeUndefined();
    expect((res.result as any[])).toHaveLength(1);
  });

  it('handles get_agents via runtime snapshot', async () => {
    const handle = setup();
    const res = await handle({ id: '1', method: 'get_agents', params: {} });

    expect(res.error).toBeUndefined();
    expect(res.result).toEqual([]);
  });
});
