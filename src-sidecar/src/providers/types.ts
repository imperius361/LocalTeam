import type { ChatMessage } from '../types.js';

export interface SendMessageParams {
  messages: ChatMessage[];
  systemPrompt: string;
  model: string;
}

export interface LlmProvider {
  readonly id: string;
  readonly name: string;
  sendMessage(params: SendMessageParams): AsyncGenerator<string>;
}
