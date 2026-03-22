import { describe, it, expect } from 'vitest';
import { normalizeProjectConfig, parseTeamConfig, validateTeamConfig } from '../src/team-config';
import type { ProjectConfig } from '../src/types';

const validConfig: ProjectConfig = {
  version: 2,
  defaultTeamId: 'test-team',
  teams: [
    {
      id: 'test-team',
      name: 'Test Team',
      workspaceMode: 'shared_project',
      members: [
        {
          id: 'architect',
          role: 'Software Architect',
          runtimeProfileRef: 'profiles/openai-architect',
          runtimeHint: {
            provider: 'openai',
            model: 'gpt-4.1-mini',
          },
          systemPrompt: 'You are a senior software architect.',
        },
        {
          id: 'engineer',
          role: 'Engineer',
          runtimeProfileRef: 'profiles/anthropic-engineer',
          runtimeHint: {
            provider: 'anthropic',
            model: 'claude-sonnet',
          },
          systemPrompt: 'You are a senior software engineer.',
        },
      ],
    },
  ],
  consensus: {
    maxRounds: 3,
    requiredMajority: 0.66,
  },
  sandbox: {
    defaultMode: 'direct',
    useWorktrees: true,
  },
  fileAccess: {
    denyList: ['.env'],
  },
};

const legacyConfig = {
  team: {
    name: 'Legacy Team',
    agents: [
      {
        id: 'architect',
        role: 'Software Architect',
        model: 'claude-opus-4-20250514',
        provider: 'anthropic',
        systemPrompt: 'You are a senior software architect.',
      },
    ],
  },
  consensus: {
    maxRounds: 3,
    requiredMajority: 0.66,
  },
  sandbox: {
    defaultMode: 'direct',
    useWorktrees: true,
  },
  fileAccess: {
    denyList: ['.env'],
  },
};

describe('parseTeamConfig', () => {
  it('parses valid JSON into a ProjectConfig', () => {
    const json = JSON.stringify(validConfig);
    const result = parseTeamConfig(json);
    expect(result).toEqual(validConfig);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseTeamConfig('not json')).toThrow();
  });

  it('migrates a legacy single-team config into the v2 schema', () => {
    const migrated = normalizeProjectConfig(legacyConfig);
    expect(migrated.version).toBe(2);
    expect(migrated.defaultTeamId).toBe('legacy-team');
    expect(migrated.teams).toHaveLength(1);
    expect(migrated.teams[0].members[0].runtimeProfileRef).toBeNull();
    expect(migrated.teams[0].members[0].runtimeHint).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-4-20250514',
    });
  });
});

describe('validateTeamConfig', () => {
  it('accepts a valid config', () => {
    const errors = validateTeamConfig(validConfig);
    expect(errors).toEqual([]);
  });

  it('rejects config with no teams', () => {
    const config = { ...validConfig, teams: [] };
    const errors = validateTeamConfig(config);
    expect(errors).toContain('Project must have at least one team');
  });

  it('rejects config with missing team name', () => {
    const config = {
      ...validConfig,
      teams: [{ ...validConfig.teams[0], name: '' }],
    };
    const errors = validateTeamConfig(config);
    expect(errors).toContain('Team test-team: name is required');
  });

  it('rejects members with duplicate ids in a team', () => {
    const config: ProjectConfig = {
      ...validConfig,
      teams: [
        {
          ...validConfig.teams[0],
          members: [
            { ...validConfig.teams[0].members[0], id: 'same' },
            { ...validConfig.teams[0].members[1], id: 'same' },
          ],
        },
      ],
    };
    const errors = validateTeamConfig(config);
    expect(errors).toContain('Duplicate member id "same" in team test-team');
  });

  it('rejects invalid default team references', () => {
    const config: ProjectConfig = {
      ...validConfig,
      defaultTeamId: 'missing-team',
    };
    const errors = validateTeamConfig(config);
    expect(errors).toContain('defaultTeamId must reference an existing team or be null');
  });

  it('rejects invalid consensus config', () => {
    const config: ProjectConfig = {
      ...validConfig,
      consensus: { maxRounds: 0, requiredMajority: 1.5 },
    };
    const errors = validateTeamConfig(config);
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects agents missing required fields', () => {
    const config: ProjectConfig = {
      ...validConfig,
      teams: [
        {
          ...validConfig.teams[0],
          members: [
            { id: '', role: '', runtimeProfileRef: null, systemPrompt: '' },
          ],
        },
      ],
    };
    const errors = validateTeamConfig(config);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects invalid command policy fields on agents', () => {
    const config: ProjectConfig = {
      ...validConfig,
      teams: [
        {
          ...validConfig.teams[0],
          members: [
            {
              ...validConfig.teams[0].members[0],
              canExecuteCommands: 'yes' as any,
              preApprovedCommands: [123 as any],
              allowedPaths: [true as any],
            },
          ],
        },
      ],
    };
    const errors = validateTeamConfig(config);
    expect(errors.some((error) => error.includes('canExecuteCommands'))).toBe(true);
    expect(errors.some((error) => error.includes('preApprovedCommands'))).toBe(true);
    expect(errors.some((error) => error.includes('allowedPaths'))).toBe(true);
  });
});
