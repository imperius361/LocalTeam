import { describe, it, expect, vi } from 'vitest';
import { OpenAIProvider } from '../../src/providers/openai';

function createMockStream(textChunks: string[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const content of textChunks) {
        yield {
          choices: [{ delta: { content }, index: 0, finish_reason: null }],
        };
      }
    },
  };
}

function createMockClient(textChunks: string[]) {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue(createMockStream(textChunks)),
      },
    },
  };
}

describe('OpenAIProvider', () => {
  it('has correct id and name', () => {
    const provider = new OpenAIProvider(createMockClient([]) as any);
    expect(provider.id).toBe('openai');
    expect(provider.name).toBe('OpenAI');
  });

  it('streams text chunks from the OpenAI API', async () => {
    const mockClient = createMockClient(['Hello', ' world', '!']);
    const provider = new OpenAIProvider(mockClient as any);

    const chunks: string[] = [];
    for await (const chunk of provider.sendMessage({
      messages: [{ role: 'user', content: 'Hi' }],
      systemPrompt: 'You are helpful',
      model: 'gpt-4o',
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['Hello', ' world', '!']);
  });

  it('passes correct parameters to the SDK', async () => {
    const mockClient = createMockClient(['OK']);
    const provider = new OpenAIProvider(mockClient as any);

    for await (const _ of provider.sendMessage({
      messages: [{ role: 'user', content: 'Hello' }],
      systemPrompt: 'Be concise',
      model: 'gpt-4o',
    })) { /* drain */ }

    expect(mockClient.chat.completions.create).toHaveBeenCalledWith({
      model: 'gpt-4o',
      stream: true,
      messages: [
        { role: 'system', content: 'Be concise' },
        { role: 'user', content: 'Hello' },
      ],
    });
  });

  it('skips chunks with null content', async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            async *[Symbol.asyncIterator]() {
              yield { choices: [{ delta: { content: 'Hi' }, index: 0 }] };
              yield { choices: [{ delta: { content: null }, index: 0 }] };
              yield { choices: [{ delta: {}, index: 0 }] };
              yield { choices: [{ delta: { content: '!' }, index: 0 }] };
            },
          }),
        },
      },
    };
    const provider = new OpenAIProvider(mockClient as any);

    const chunks: string[] = [];
    for await (const chunk of provider.sendMessage({
      messages: [{ role: 'user', content: 'Hi' }],
      systemPrompt: 'test',
      model: 'gpt-4o',
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['Hi', '!']);
  });
});
