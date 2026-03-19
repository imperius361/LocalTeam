import type { LlmProvider, SendMessageParams } from './types.js';

export class MockProvider implements LlmProvider {
  readonly id = 'mock';
  readonly name = 'Mock';

  private responses: string[];
  private callIndex = 0;
  readonly callHistory: SendMessageParams[] = [];

  constructor(responses: string[] = ['Mock response']) {
    this.responses = responses;
  }

  async *sendMessage(params: SendMessageParams): AsyncGenerator<string> {
    this.callHistory.push({ ...params });
    const response = this.responses[this.callIndex % this.responses.length];
    this.callIndex++;
    yield response;
  }
}
