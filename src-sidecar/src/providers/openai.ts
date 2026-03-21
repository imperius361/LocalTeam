import type OpenAI from 'openai';
import type { LlmProvider, SendMessageParams } from './types.js';

export class OpenAIProvider implements LlmProvider {
  readonly id = 'openai';
  readonly name = 'OpenAI';

  constructor(private client: OpenAI) {}

  async *sendMessage(params: SendMessageParams): AsyncGenerator<string> {
    const stream = await this.client.chat.completions.create({
      model: params.model,
      stream: true,
      messages: [
        { role: 'system', content: params.systemPrompt },
        ...params.messages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      ],
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }
}
