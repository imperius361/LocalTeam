import { describe, it, expect, vi } from 'vitest';
import { AnthropicProvider } from '../../src/providers/anthropic';

function createMockStream(textChunks: string[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const text of textChunks) {
        yield {
          type: 'content_block_delta' as const,
          index: 0,
          delta: { type: 'text_delta' as const, text },
        };
      }
    },
  };
}

function createMockClient(textChunks: string[]) {
  return {
    messages: {
      stream: vi.fn().mockReturnValue(createMockStream(textChunks)),
    },
  };
}

describe('AnthropicProvider', () => {
  it('has correct id and name', () => {
    const provider = new AnthropicProvider(createMockClient([]) as any);
    expect(provider.id).toBe('anthropic');
    expect(provider.name).toBe('Anthropic');
  });

  it('streams text chunks from the Claude API', async () => {
    const mockClient = createMockClient(['Hello', ' world', '!']);
    const provider = new AnthropicProvider(mockClient as any);

    const chunks: string[] = [];
    for await (const chunk of provider.sendMessage({
      messages: [{ role: 'user', content: 'Hi' }],
      systemPrompt: 'You are helpful',
      model: 'claude-sonnet-4-20250514',
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['Hello', ' world', '!']);
  });

  it('passes correct parameters to the SDK', async () => {
    const mockClient = createMockClient(['OK']);
    const provider = new AnthropicProvider(mockClient as any);

    for await (const _ of provider.sendMessage({
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
        { role: 'user', content: 'How are you?' },
      ],
      systemPrompt: 'Be concise',
      model: 'claude-opus-4-20250514',
    })) { /* drain */ }

    expect(mockClient.messages.stream).toHaveBeenCalledWith({
      model: 'claude-opus-4-20250514',
      max_tokens: 4096,
      system: 'Be concise',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
        { role: 'user', content: 'How are you?' },
      ],
    });
  });

  it('ignores non-text-delta events', async () => {
    const mockClient = {
      messages: {
        stream: vi.fn().mockReturnValue({
          async *[Symbol.asyncIterator]() {
            yield { type: 'message_start', message: {} };
            yield {
              type: 'content_block_delta',
              index: 0,
              delta: { type: 'text_delta', text: 'Hello' },
            };
            yield { type: 'message_stop' };
          },
        }),
      },
    };
    const provider = new AnthropicProvider(mockClient as any);

    const chunks: string[] = [];
    for await (const chunk of provider.sendMessage({
      messages: [{ role: 'user', content: 'Hi' }],
      systemPrompt: 'test',
      model: 'claude-sonnet-4-20250514',
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['Hello']);
  });
});
