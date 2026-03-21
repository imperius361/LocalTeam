import { describe, it, expect } from 'vitest';
import { MockProvider } from '../../src/providers/mock';

describe('MockProvider', () => {
  it('has correct id and name', () => {
    const provider = new MockProvider();
    expect(provider.id).toBe('mock');
    expect(provider.name).toBe('Mock');
  });

  it('yields the default response when none configured', async () => {
    const provider = new MockProvider();
    const chunks: string[] = [];
    for await (const chunk of provider.sendMessage({
      messages: [{ role: 'user', content: 'Hi' }],
      systemPrompt: 'test',
      model: 'mock',
    })) {
      chunks.push(chunk);
    }
    expect(chunks.join('')).toBe('Mock response');
  });

  it('cycles through configured responses', async () => {
    const provider = new MockProvider(['First reply', 'Second reply']);
    const results: string[] = [];

    for (let i = 0; i < 3; i++) {
      let full = '';
      for await (const chunk of provider.sendMessage({
        messages: [{ role: 'user', content: 'Hi' }],
        systemPrompt: 'test',
        model: 'mock',
      })) {
        full += chunk;
      }
      results.push(full);
    }

    expect(results).toEqual(['First reply', 'Second reply', 'First reply']);
  });

  it('records call history', async () => {
    const provider = new MockProvider();
    const params = {
      messages: [{ role: 'user' as const, content: 'Hello' }],
      systemPrompt: 'Be helpful',
      model: 'mock-model',
    };

    // Consume the generator
    for await (const _ of provider.sendMessage(params)) { /* drain */ }

    expect(provider.callHistory).toHaveLength(1);
    expect(provider.callHistory[0].systemPrompt).toBe('Be helpful');
  });
});
