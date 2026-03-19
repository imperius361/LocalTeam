import { describe, it, expect } from 'vitest';
import { Agent } from '../src/agent';
import { MockProvider } from '../src/providers/mock';
import type { AgentConfig } from '../src/types';

const testConfig: AgentConfig = {
  id: 'architect',
  role: 'Software Architect',
  model: 'mock-model',
  provider: 'anthropic',
  systemPrompt: 'You are a senior software architect.',
};

describe('Agent', () => {
  it('exposes config properties', () => {
    const provider = new MockProvider();
    const agent = new Agent(testConfig, provider);

    expect(agent.id).toBe('architect');
    expect(agent.role).toBe('Software Architect');
    expect(agent.model).toBe('mock-model');
  });

  it('responds by streaming from the provider', async () => {
    const provider = new MockProvider(['I suggest using microservices.']);
    const agent = new Agent(testConfig, provider);

    let fullResponse = '';
    for await (const chunk of agent.respond('What architecture should we use?')) {
      fullResponse += chunk;
    }

    expect(fullResponse).toBe('I suggest using microservices.');
  });

  it('maintains conversation history', async () => {
    const provider = new MockProvider(['Reply 1', 'Reply 2']);
    const agent = new Agent(testConfig, provider);

    for await (const _ of agent.respond('First question')) { /* drain */ }
    for await (const _ of agent.respond('Second question')) { /* drain */ }

    const history = agent.getHistory();
    expect(history).toHaveLength(4);
    expect(history[0]).toEqual({ role: 'user', content: 'First question' });
    expect(history[1]).toEqual({ role: 'assistant', content: 'Reply 1' });
    expect(history[2]).toEqual({ role: 'user', content: 'Second question' });
    expect(history[3]).toEqual({ role: 'assistant', content: 'Reply 2' });
  });

  it('passes system prompt and history to the provider', async () => {
    const provider = new MockProvider(['OK']);
    const agent = new Agent(testConfig, provider);

    for await (const _ of agent.respond('Hello')) { /* drain */ }

    expect(provider.callHistory).toHaveLength(1);
    expect(provider.callHistory[0].systemPrompt).toBe(
      'You are a senior software architect.',
    );
    expect(provider.callHistory[0].messages).toEqual([
      { role: 'user', content: 'Hello' },
    ]);
  });

  it('resets history when reset() is called', async () => {
    const provider = new MockProvider(['Reply']);
    const agent = new Agent(testConfig, provider);

    for await (const _ of agent.respond('Hello')) { /* drain */ }
    expect(agent.getHistory()).toHaveLength(2);

    agent.reset();
    expect(agent.getHistory()).toHaveLength(0);
  });
});
