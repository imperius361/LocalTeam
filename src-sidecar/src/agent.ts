import type { AgentConfig, ChatMessage } from './types.js';
import type { LlmProvider } from './providers/types.js';

export class Agent {
  readonly id: string;
  readonly role: string;
  readonly model: string;

  private provider: LlmProvider;
  private systemPrompt: string;
  private history: ChatMessage[] = [];

  constructor(config: AgentConfig, provider: LlmProvider) {
    this.id = config.id;
    this.role = config.role;
    this.model = config.model;
    this.provider = provider;
    this.systemPrompt = config.systemPrompt;
  }

  async *respond(input: string): AsyncGenerator<string> {
    this.history.push({ role: 'user', content: input });

    let fullResponse = '';
    for await (const token of this.provider.sendMessage({
      messages: [...this.history],
      systemPrompt: this.systemPrompt,
      model: this.model,
    })) {
      fullResponse += token;
      yield token;
    }

    this.history.push({ role: 'assistant', content: fullResponse });
  }

  getHistory(): ChatMessage[] {
    return [...this.history];
  }

  reset(): void {
    this.history = [];
  }
}
