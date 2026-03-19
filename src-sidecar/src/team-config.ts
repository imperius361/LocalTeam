import type { TeamConfig } from './types.js';

const SUPPORTED_PROVIDERS = ['anthropic', 'openai'];

export function parseTeamConfig(json: string): TeamConfig {
  return JSON.parse(json) as TeamConfig;
}

export function validateTeamConfig(config: TeamConfig): string[] {
  const errors: string[] = [];

  if (!config.name) {
    errors.push('Team name is required');
  }

  if (!config.agents || config.agents.length === 0) {
    errors.push('Team must have at least one agent');
  }

  // Check for duplicate agent IDs
  const ids = new Set<string>();
  for (const agent of config.agents) {
    if (ids.has(agent.id)) {
      errors.push(`Duplicate agent id: ${agent.id}`);
    }
    ids.add(agent.id);

    if (!agent.id) {
      errors.push('Agent id is required');
    }
    if (!agent.role) {
      errors.push(`Agent ${agent.id || '(unnamed)'}: role is required`);
    }
    if (!agent.model) {
      errors.push(`Agent ${agent.id || '(unnamed)'}: model is required`);
    }
    if (!agent.systemPrompt) {
      errors.push(`Agent ${agent.id || '(unnamed)'}: systemPrompt is required`);
    }
    if (!SUPPORTED_PROVIDERS.includes(agent.provider)) {
      errors.push(
        `Unsupported provider "${agent.provider}" for agent ${agent.id}`,
      );
    }
  }

  // Validate consensus config
  if (config.consensus.maxRounds < 1) {
    errors.push('consensus.maxRounds must be at least 1');
  }
  if (
    config.consensus.requiredMajority <= 0 ||
    config.consensus.requiredMajority > 1
  ) {
    errors.push('consensus.requiredMajority must be between 0 and 1');
  }

  return errors;
}
