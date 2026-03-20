import type { ProjectConfig } from './types.js';

const SUPPORTED_PROVIDERS = ['anthropic', 'openai', 'mock'];

export function parseProjectConfig(json: string): ProjectConfig {
  return JSON.parse(json) as ProjectConfig;
}

export function validateProjectConfig(config: ProjectConfig): string[] {
  const errors: string[] = [];

  if (!config.team?.name) {
    errors.push('Team name is required');
  }

  if (!config.team?.agents || config.team.agents.length === 0) {
    errors.push('Team must have at least one agent');
  }

  const ids = new Set<string>();
  for (const agent of config.team?.agents ?? []) {
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

  if (!config.consensus || config.consensus.maxRounds < 1) {
    errors.push('consensus.maxRounds must be at least 1');
  }
  if (
    !config.consensus ||
    config.consensus.requiredMajority <= 0 ||
    config.consensus.requiredMajority > 1
  ) {
    errors.push('consensus.requiredMajority must be between 0 and 1');
  }

  if (!config.sandbox) {
    errors.push('sandbox configuration is required');
  } else if (!['direct', 'worktree'].includes(config.sandbox.defaultMode)) {
    errors.push('sandbox.defaultMode must be "direct" or "worktree"');
  }

  if (!config.fileAccess) {
    errors.push('fileAccess configuration is required');
  } else if (!Array.isArray(config.fileAccess.denyList)) {
    errors.push('fileAccess.denyList must be an array');
  }

  return errors;
}

export function parseTeamConfig(json: string): ProjectConfig {
  return parseProjectConfig(json);
}

export function validateTeamConfig(config: ProjectConfig): string[] {
  return validateProjectConfig(config);
}
