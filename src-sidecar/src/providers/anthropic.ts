import type Anthropic from '@anthropic-ai/sdk';
import type { LlmProvider, SendMessageParams } from './types.js';

export class AnthropicProvider implements LlmProvider {
  readonly id = 'anthropic';
  readonly name = 'Anthropic';

  constructor(private client: Anthropic) {}

  async *sendMessage(params: SendMessageParams): AsyncGenerator<string> {
    const stream = this.client.messages.stream({
      model: params.model,
      max_tokens: 4096,
      system: params.systemPrompt,
      messages: params.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield event.delta.text;
      }
    }
  }
}
