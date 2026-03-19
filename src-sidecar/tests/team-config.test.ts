import { describe, it, expect } from 'vitest';
import { parseTeamConfig, validateTeamConfig } from '../src/team-config';
import type { TeamConfig } from '../src/types';

const validConfig: TeamConfig = {
  name: 'Test Team',
  agents: [
    {
      id: 'architect',
      role: 'Software Architect',
      model: 'claude-opus-4-20250514',
      provider: 'anthropic',
      systemPrompt: 'You are a senior software architect.',
    },
    {
      id: 'engineer',
      role: 'Engineer',
      model: 'gpt-4o',
      provider: 'openai',
      systemPrompt: 'You are a senior software engineer.',
    },
  ],
  consensus: {
    maxRounds: 3,
    requiredMajority: 0.66,
  },
};

describe('parseTeamConfig', () => {
  it('parses valid JSON into a TeamConfig', () => {
    const json = JSON.stringify(validConfig);
    const result = parseTeamConfig(json);
    expect(result).toEqual(validConfig);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseTeamConfig('not json')).toThrow();
  });
});

describe('validateTeamConfig', () => {
  it('accepts a valid config', () => {
    const errors = validateTeamConfig(validConfig);
    expect(errors).toEqual([]);
  });

  it('rejects config with no agents', () => {
    const config = { ...validConfig, agents: [] };
    const errors = validateTeamConfig(config);
    expect(errors).toContain('Team must have at least one agent');
  });

  it('rejects config with missing team name', () => {
    const config = { ...validConfig, name: '' };
    const errors = validateTeamConfig(config);
    expect(errors).toContain('Team name is required');
  });

  it('rejects agents with duplicate ids', () => {
    const config: TeamConfig = {
      ...validConfig,
      agents: [
        { ...validConfig.agents[0], id: 'same' },
        { ...validConfig.agents[1], id: 'same' },
      ],
    };
    const errors = validateTeamConfig(config);
    expect(errors).toContain('Duplicate agent id: same');
  });

  it('rejects agents with unsupported provider', () => {
    const config: TeamConfig = {
      ...validConfig,
      agents: [
        { ...validConfig.agents[0], provider: 'unsupported' as any },
      ],
    };
    const errors = validateTeamConfig(config);
    expect(errors[0]).toContain('Unsupported provider');
  });

  it('rejects invalid consensus config', () => {
    const config: TeamConfig = {
      ...validConfig,
      consensus: { maxRounds: 0, requiredMajority: 1.5 },
    };
    const errors = validateTeamConfig(config);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects agents missing required fields', () => {
    const config: TeamConfig = {
      ...validConfig,
      agents: [
        { id: '', role: '', model: '', provider: 'anthropic', systemPrompt: '' },
      ],
    };
    const errors = validateTeamConfig(config);
    expect(errors.length).toBeGreaterThan(0);
  });
});
