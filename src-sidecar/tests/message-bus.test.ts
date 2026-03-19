import { describe, it, expect, vi } from 'vitest';
import { MessageBus } from '../src/message-bus';
import type { AgentMessage } from '../src/types';

function makeMessage(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: 'msg-1',
    agentId: 'agent-1',
    agentRole: 'Architect',
    type: 'discussion',
    content: 'Test message',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('MessageBus', () => {
  it('delivers messages to subscribers', () => {
    const bus = new MessageBus();
    const handler = vi.fn();
    bus.on('message', handler);

    const msg = makeMessage();
    bus.emit(msg);

    expect(handler).toHaveBeenCalledWith(msg);
  });

  it('delivers messages filtered by type', () => {
    const bus = new MessageBus();
    const proposalHandler = vi.fn();
    const discussionHandler = vi.fn();
    bus.on('message:proposal', proposalHandler);
    bus.on('message:discussion', discussionHandler);

    bus.emit(makeMessage({ type: 'proposal' }));

    expect(proposalHandler).toHaveBeenCalledTimes(1);
    expect(discussionHandler).not.toHaveBeenCalled();
  });

  it('delivers messages filtered by agent', () => {
    const bus = new MessageBus();
    const handler = vi.fn();
    bus.on('agent:agent-2', handler);

    bus.emit(makeMessage({ agentId: 'agent-1' }));
    bus.emit(makeMessage({ agentId: 'agent-2' }));

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('supports unsubscribing', () => {
    const bus = new MessageBus();
    const handler = vi.fn();
    bus.on('message', handler);
    bus.off('message', handler);

    bus.emit(makeMessage());

    expect(handler).not.toHaveBeenCalled();
  });

  it('collects all messages in history', () => {
    const bus = new MessageBus();
    const msg1 = makeMessage({ id: 'a' });
    const msg2 = makeMessage({ id: 'b' });
    bus.emit(msg1);
    bus.emit(msg2);

    expect(bus.getHistory()).toEqual([msg1, msg2]);
  });

  it('filters history by taskId', () => {
    const bus = new MessageBus();
    bus.emit(makeMessage({ id: 'a', taskId: 'task-1' }));
    bus.emit(makeMessage({ id: 'b', taskId: 'task-2' }));
    bus.emit(makeMessage({ id: 'c', taskId: 'task-1' }));

    const filtered = bus.getHistory('task-1');
    expect(filtered).toHaveLength(2);
    expect(filtered.map((m) => m.id)).toEqual(['a', 'c']);
  });
});
