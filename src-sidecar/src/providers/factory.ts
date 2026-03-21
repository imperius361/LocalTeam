import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { Agent } from '../agent.js';
import type { AgentConfig, ProviderId } from '../types.js';
import { AnthropicProvider } from './anthropic.js';
import { MockProvider } from './mock.js';
import { OpenAIProvider } from './openai.js';

export function createAgent(
  config: AgentConfig,
  credentials: Map<ProviderId, string>,
): { agent: Agent; hasCredentials: boolean; lastError?: string } {
  if (config.provider === 'openai') {
    const apiKey = credentials.get('openai');
    if (apiKey) {
      return {
        agent: new Agent(config, new OpenAIProvider(new OpenAI({ apiKey }))),
        hasCredentials: true,
      };
    }
  }

  if (config.provider === 'anthropic') {
    const apiKey = credentials.get('anthropic');
    if (apiKey) {
      return {
        agent: new Agent(
          config,
          new AnthropicProvider(new Anthropic({ apiKey })),
        ),
        hasCredentials: true,
      };
    }
  }

  return {
    agent: new Agent(
      config,
      new MockProvider([
        `OBJECTION: ${config.role} is waiting for a ${config.provider} API key. Sync credentials to enable live model output.`,
      ]),
    ),
    hasCredentials: false,
    lastError: `Missing ${config.provider} credential`,
  };
}
