import type { ProjectConfig } from './types.js';

interface LegacyAgentConfig {
  id?: string;
  role?: string;
  model?: string;
  provider?: string;
  systemPrompt?: string;
  tools?: string[];
  allowedPaths?: string[];
  canExecuteCommands?: boolean;
  preApprovedCommands?: string[];
}

interface LegacyProjectConfig {
  team?: {
    name?: string;
    agents?: LegacyAgentConfig[];
  };
  consensus?: ProjectConfig['consensus'];
  sandbox?: ProjectConfig['sandbox'];
  fileAccess?: ProjectConfig['fileAccess'];
}

export function parseProjectConfig(json: string): ProjectConfig {
  return normalizeProjectConfig(JSON.parse(json));
}

export function normalizeProjectConfig(input: unknown): ProjectConfig {
  if (!input || typeof input !== 'object') {
    throw new Error('Project config must be an object');
  }

  const config = input as Partial<ProjectConfig> & LegacyProjectConfig;
  if (Array.isArray(config.teams)) {
    return {
      version: 2,
      defaultTeamId:
        typeof config.defaultTeamId === 'string' && config.defaultTeamId.trim()
          ? config.defaultTeamId.trim()
          : null,
      teams: config.teams.map((team) => ({
        id: team.id,
        name: team.name,
        workspaceMode: 'shared_project',
        members: team.members.map((member) => ({
          id: member.id,
          role: member.role,
          systemPrompt: member.systemPrompt,
          runtimeProfileRef:
            typeof member.runtimeProfileRef === 'string' && member.runtimeProfileRef.trim()
              ? member.runtimeProfileRef.trim()
              : null,
          ...(member.runtimeHint ? { runtimeHint: { ...member.runtimeHint } } : {}),
          ...(member.tools ? { tools: [...member.tools] } : {}),
          ...(member.allowedPaths ? { allowedPaths: [...member.allowedPaths] } : {}),
          ...(member.canExecuteCommands !== undefined
            ? { canExecuteCommands: member.canExecuteCommands }
            : {}),
          ...(member.preApprovedCommands
            ? { preApprovedCommands: [...member.preApprovedCommands] }
            : {}),
        })),
      })),
      ...(config.consensus ? { consensus: { ...config.consensus } } : {}),
      sandbox: { ...config.sandbox! },
      fileAccess: {
        denyList: [...(config.fileAccess?.denyList ?? [])],
      },
    };
  }

  if (!config.team || !Array.isArray(config.team.agents)) {
    throw new Error('Project config must define teams');
  }

  const teamName = typeof config.team.name === 'string' && config.team.name.trim()
    ? config.team.name.trim()
    : 'Default Team';
  const teamId = deriveTeamId(teamName);

  return {
    version: 2,
    defaultTeamId: teamId,
    teams: [
      {
        id: teamId,
        name: teamName,
        workspaceMode: 'shared_project',
        members: config.team.agents.map((agent, index) => ({
          id:
            typeof agent.id === 'string' && agent.id.trim()
              ? agent.id.trim()
              : `member-${index + 1}`,
          role: typeof agent.role === 'string' ? agent.role : '',
          systemPrompt:
            typeof agent.systemPrompt === 'string' ? agent.systemPrompt : '',
          runtimeProfileRef: null,
          ...((agent.provider || agent.model)
            ? {
                runtimeHint: {
                  ...(agent.provider ? { provider: agent.provider } : {}),
                  ...(agent.model ? { model: agent.model } : {}),
                },
              }
            : {}),
          ...(agent.tools ? { tools: [...agent.tools] } : {}),
          ...(agent.allowedPaths ? { allowedPaths: [...agent.allowedPaths] } : {}),
          ...(agent.canExecuteCommands !== undefined
            ? { canExecuteCommands: agent.canExecuteCommands }
            : {}),
          ...(agent.preApprovedCommands
            ? { preApprovedCommands: [...agent.preApprovedCommands] }
            : {}),
        })),
      },
    ],
    ...(config.consensus ? { consensus: { ...config.consensus } } : {}),
    sandbox: { ...config.sandbox! },
    fileAccess: {
      denyList: [...(config.fileAccess?.denyList ?? [])],
    },
  };
}

export function validateProjectConfig(config: ProjectConfig): string[] {
  const errors: string[] = [];

  if (config.version !== 2) {
    errors.push('version must be 2');
  }

  if (!Array.isArray(config.teams) || config.teams.length === 0) {
    errors.push('Project must have at least one team');
  }

  const teamIds = new Set<string>();
  for (const team of config.teams ?? []) {
    if (!team.id?.trim()) {
      errors.push('Team id is required');
    } else if (teamIds.has(team.id)) {
      errors.push(`Duplicate team id: ${team.id}`);
    } else {
      teamIds.add(team.id);
    }

    if (!team.name?.trim()) {
      errors.push(`Team ${team.id || '(unnamed)'}: name is required`);
    }

    if (team.workspaceMode !== 'shared_project') {
      errors.push(
        `Team ${team.id || '(unnamed)'}: workspaceMode must be "shared_project"`,
      );
    }

    if (!team.members || team.members.length === 0) {
      errors.push(`Team ${team.id || '(unnamed)'} must have at least one member`);
    }

    const memberIds = new Set<string>();
    for (const member of team.members ?? []) {
      if (!member.id?.trim()) {
        errors.push(`Team ${team.id || '(unnamed)'}: member id is required`);
      } else if (memberIds.has(member.id)) {
        errors.push(`Duplicate member id "${member.id}" in team ${team.id || '(unnamed)'}`);
      } else {
        memberIds.add(member.id);
      }

      if (!member.role?.trim()) {
        errors.push(`Member ${member.id || '(unnamed)'}: role is required`);
      }
      if (!member.systemPrompt?.trim()) {
        errors.push(`Member ${member.id || '(unnamed)'}: systemPrompt is required`);
      }
      if (
        member.runtimeProfileRef !== null &&
        (typeof member.runtimeProfileRef !== 'string' || !member.runtimeProfileRef.trim())
      ) {
        errors.push(
          `Member ${member.id || '(unnamed)'}: runtimeProfileRef must be a non-empty string or null`,
        );
      }
      if (
        member.allowedPaths !== undefined &&
        !Array.isArray(member.allowedPaths)
      ) {
        errors.push(`Member ${member.id || '(unnamed)'}: allowedPaths must be an array`);
      }
      if (
        member.allowedPaths &&
        member.allowedPaths.some((path) => typeof path !== 'string' || !path.trim())
      ) {
        errors.push(
          `Member ${member.id || '(unnamed)'}: allowedPaths must contain non-empty strings`,
        );
      }
      if (
        member.canExecuteCommands !== undefined &&
        typeof member.canExecuteCommands !== 'boolean'
      ) {
        errors.push(
          `Member ${member.id || '(unnamed)'}: canExecuteCommands must be a boolean`,
        );
      }
      if (
        member.preApprovedCommands !== undefined &&
        !Array.isArray(member.preApprovedCommands)
      ) {
        errors.push(
          `Member ${member.id || '(unnamed)'}: preApprovedCommands must be an array`,
        );
      }
      if (
        member.preApprovedCommands &&
        member.preApprovedCommands.some(
          (command) => typeof command !== 'string' || !command.trim(),
        )
      ) {
        errors.push(
          `Member ${member.id || '(unnamed)'}: preApprovedCommands must contain non-empty strings`,
        );
      }
    }
  }

  if (config.defaultTeamId !== null && !teamIds.has(config.defaultTeamId)) {
    errors.push('defaultTeamId must reference an existing team or be null');
  }

  if (config.consensus && config.consensus.maxRounds < 1) {
    errors.push('consensus.maxRounds must be at least 1');
  }
  if (
    config.consensus &&
    (config.consensus.requiredMajority <= 0 ||
      config.consensus.requiredMajority > 1)
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

function deriveTeamId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'team';
}
