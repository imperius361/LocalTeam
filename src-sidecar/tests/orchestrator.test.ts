import { describe, it, expect } from 'vitest';
import { Orchestrator } from '../src/orchestrator';
import { Agent } from '../src/agent';
import { MessageBus } from '../src/message-bus';
import { MockProvider } from '../src/providers/mock';
import type { LlmProvider, SendMessageParams } from '../src/providers/types';
import type { AgentConfig, AgentMessage } from '../src/types';

function makeAgent(id: string, role: string, responses: string[]): Agent {
  const config: AgentConfig = {
    id,
    role,
    model: 'mock',
    provider: 'anthropic',
    systemPrompt: `You are a ${role}.`,
  };
  return new Agent(config, new MockProvider(responses));
}

class ChunkedProvider implements LlmProvider {
  readonly id = 'mock';
  readonly name = 'Chunked';

  constructor(private readonly chunks: string[]) {}

  async *sendMessage(_params: SendMessageParams): AsyncGenerator<string> {
    for (const chunk of this.chunks) {
      yield chunk;
    }
  }
}

class FailingProvider implements LlmProvider {
  readonly id = 'mock';
  readonly name = 'Failing';

  async *sendMessage(_params: SendMessageParams): AsyncGenerator<string> {
    yield 'partial';
    throw new Error('Provider unavailable');
  }
}

describe('Orchestrator', () => {
  it('runs a round-robin discussion round', async () => {
    const bus = new MessageBus();
    const orchestrator = new Orchestrator(bus);

    orchestrator.addAgent(makeAgent('arch', 'Architect', ['Use microservices']));
    orchestrator.addAgent(makeAgent('eng', 'Engineer', ['Prefer monolith']));

    const messages: AgentMessage[] = [];
    for await (const msg of orchestrator.runRound('task-1', 'What architecture?')) {
      messages.push(msg);
    }

    expect(messages).toHaveLength(2);
    expect(messages[0].agentId).toBe('arch');
    expect(messages[0].content).toBe('Use microservices');
    expect(messages[0].type).toBe('discussion');
    expect(messages[0].taskId).toBe('task-1');
    expect(messages[1].agentId).toBe('eng');
    expect(messages[1].content).toBe('Prefer monolith');
  });

  it('includes all agent messages in the message bus', async () => {
    const bus = new MessageBus();
    const orchestrator = new Orchestrator(bus);

    orchestrator.addAgent(makeAgent('a', 'Role A', ['Reply A']));
    orchestrator.addAgent(makeAgent('b', 'Role B', ['Reply B']));

    for await (const _ of orchestrator.runRound('task-1', 'Discuss')) { /* drain */ }

    const history = bus.getHistory('task-1');
    expect(history).toHaveLength(2);
  });

  it('passes prior round context to each agent', async () => {
    const bus = new MessageBus();
    const orchestrator = new Orchestrator(bus);

    const providerA = new MockProvider(['Round 1 from A', 'Round 2 from A']);
    const providerB = new MockProvider(['Round 1 from B', 'Round 2 from B']);

    const configA: AgentConfig = {
      id: 'a', role: 'A', model: 'mock', provider: 'anthropic',
      systemPrompt: 'You are A.',
    };
    const configB: AgentConfig = {
      id: 'b', role: 'B', model: 'mock', provider: 'anthropic',
      systemPrompt: 'You are B.',
    };

    orchestrator.addAgent(new Agent(configA, providerA));
    orchestrator.addAgent(new Agent(configB, providerB));

    // Run two rounds
    for await (const _ of orchestrator.runRound('task-1', 'Topic')) { /* drain */ }
    for await (const _ of orchestrator.runRound('task-1', 'Continue discussion')) { /* drain */ }

    // Agent A should have 2 calls (one per round)
    expect(providerA.callHistory).toHaveLength(2);
    // Second call should have the first exchange in history
    expect(providerA.callHistory[1].messages.length).toBeGreaterThan(1);
  });

  it('returns agent list', () => {
    const bus = new MessageBus();
    const orchestrator = new Orchestrator(bus);

    orchestrator.addAgent(makeAgent('a', 'Role A', ['x']));
    orchestrator.addAgent(makeAgent('b', 'Role B', ['y']));

    const agents = orchestrator.getAgents();
    expect(agents.map((a) => a.id)).toEqual(['a', 'b']);
  });

  it('emits stream deltas with stable message identity and finalization', async () => {
    const bus = new MessageBus();
    const orchestrator = new Orchestrator(bus);
    const config: AgentConfig = {
      id: 'streamer',
      role: 'Engineer',
      model: 'mock',
      provider: 'anthropic',
      systemPrompt: 'Stream in chunks.',
    };
    orchestrator.addAgent(new Agent(config, new ChunkedProvider(['Hello', ' ', 'world'])));

    const deltas: Array<{ messageId: string; content: string; delta: string }> = [];
    const finalized: string[] = [];
    const results: AgentMessage[] = [];

    for await (const message of orchestrator.runRound('task-stream', 'Prompt', 1, {
      onStreamDelta: (event) => {
        deltas.push({
          messageId: event.messageId,
          content: event.content,
          delta: event.delta,
        });
      },
      onMessageFinalized: ({ message }) => {
        finalized.push(message.id);
      },
    })) {
      results.push(message);
    }

    expect(results).toHaveLength(1);
    expect(results[0].content).toBe('Hello world');
    expect(deltas).toHaveLength(3);
    expect(deltas.map((entry) => entry.delta)).toEqual(['Hello', ' ', 'world']);
    expect(deltas.map((entry) => entry.messageId)).toEqual([
      results[0].id,
      results[0].id,
      results[0].id,
    ]);
    expect(deltas[2].content).toBe('Hello world');
    expect(finalized).toEqual([results[0].id]);
  });

  it('reports stream failures with message context before rethrowing', async () => {
    const bus = new MessageBus();
    const orchestrator = new Orchestrator(bus);
    const config: AgentConfig = {
      id: 'streamer',
      role: 'Engineer',
      model: 'mock',
      provider: 'anthropic',
      systemPrompt: 'Fail after one chunk.',
    };
    orchestrator.addAgent(new Agent(config, new FailingProvider()));

    const deltas: Array<{ messageId: string; content: string }> = [];
    const failures: Array<{
      messageId: string;
      agentId: string;
      content: string;
      error: string;
    }> = [];

    await expect(async () => {
      for await (const _ of orchestrator.runRound('task-stream', 'Prompt', 1, {
        onStreamDelta: (event) => {
          deltas.push({
            messageId: event.messageId,
            content: event.content,
          });
        },
        onMessageError: (event) => {
          failures.push({
            messageId: event.messageId,
            agentId: event.agentId,
            content: event.content,
            error: event.error instanceof Error ? event.error.message : String(event.error),
          });
        },
      })) {
        // drain
      }
    }).rejects.toThrow('Provider unavailable');

    expect(deltas).toHaveLength(1);
    expect(failures).toEqual([
      {
        messageId: deltas[0].messageId,
        agentId: 'streamer',
        content: 'partial',
        error: 'Provider unavailable',
      },
    ]);
    expect(bus.getHistory('task-stream')).toHaveLength(0);
  });

  it('removes an agent', async () => {
    const bus = new MessageBus();
    const orchestrator = new Orchestrator(bus);

    orchestrator.addAgent(makeAgent('a', 'Role A', ['x']));
    orchestrator.addAgent(makeAgent('b', 'Role B', ['y']));
    orchestrator.removeAgent('a');

    const messages: AgentMessage[] = [];
    for await (const msg of orchestrator.runRound('task-1', 'Discuss')) {
      messages.push(msg);
    }

    expect(messages).toHaveLength(1);
    expect(messages[0].agentId).toBe('b');
  });
});
