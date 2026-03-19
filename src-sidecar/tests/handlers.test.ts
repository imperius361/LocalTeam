import { describe, it, expect } from 'vitest';
import { handleRequest, createHandlers } from '../src/handlers';
import { MessageBus } from '../src/message-bus';
import { Orchestrator } from '../src/orchestrator';
import { TaskManager } from '../src/task-manager';

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

describe('Orchestrator Handlers', () => {
  function setup() {
    const bus = new MessageBus();
    const orchestrator = new Orchestrator(bus);
    const taskManager = new TaskManager();
    const handle = createHandlers(orchestrator, taskManager);
    return { handle, orchestrator, taskManager, bus };
  }

  it('handles create_task', () => {
    const { handle } = setup();
    const res = handle({
      id: '1',
      method: 'create_task',
      params: { title: 'Build auth', description: 'OAuth2 login' },
    });

    expect(res.error).toBeUndefined();
    expect(res.result).toHaveProperty('id');
    expect((res.result as any).title).toBe('Build auth');
    expect((res.result as any).status).toBe('pending');
  });

  it('handles list_tasks', () => {
    const { handle, taskManager } = setup();
    taskManager.create('Task A', 'Desc A');
    taskManager.create('Task B', 'Desc B');

    const res = handle({ id: '1', method: 'list_tasks', params: {} });

    expect(res.error).toBeUndefined();
    expect((res.result as any[])).toHaveLength(2);
  });

  it('handles get_agents with empty orchestrator', () => {
    const { handle } = setup();
    const res = handle({ id: '1', method: 'get_agents', params: {} });

    expect(res.error).toBeUndefined();
    expect(res.result).toEqual([]);
  });
});
