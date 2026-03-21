import { describe, expect, it } from 'vitest';
import { evaluateCommandPolicy } from '../src/command-safety';
import type {
  AgentConfig,
  CommandExecutionRequest,
  ProjectConfig,
  Task,
} from '../src/types';

const projectRoot = '/repo';

function makeConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    team: {
      name: 'Test',
      agents: [],
    },
    consensus: {
      maxRounds: 3,
      requiredMajority: 0.66,
    },
    sandbox: {
      defaultMode: 'direct',
      useWorktrees: false,
    },
    fileAccess: {
      denyList: ['.env', '.ssh/', 'credentials*'],
    },
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Task',
    description: 'Desc',
    status: 'pending',
    assignedAgents: ['agent-1'],
    createdAt: 1,
    updatedAt: 1,
    tokenEstimate: 0,
    ...overrides,
  };
}

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'agent-1',
    role: 'Engineer',
    model: 'mock',
    provider: 'mock',
    systemPrompt: 'Do work.',
    canExecuteCommands: true,
    ...overrides,
  };
}

function makeRequest(overrides: Partial<CommandExecutionRequest> = {}): CommandExecutionRequest {
  return {
    taskId: 'task-1',
    agentId: 'agent-1',
    command: 'git status',
    cwd: '.',
    ...overrides,
  };
}

describe('evaluateCommandPolicy', () => {
  it('denies command execution when canExecuteCommands is false', () => {
    const result = evaluateCommandPolicy({
      projectRoot,
      config: makeConfig(),
      task: makeTask(),
      agent: makeAgent({ canExecuteCommands: false }),
      request: makeRequest(),
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('canExecuteCommands');
  });

  it('denies command execution when denyList is matched', () => {
    const result = evaluateCommandPolicy({
      projectRoot,
      config: makeConfig(),
      task: makeTask(),
      agent: makeAgent(),
      request: makeRequest({ command: 'cat .env' }),
    });

    expect(result.allowed).toBe(false);
    expect(result.matchedDenyRule).toBe('.env');
  });

  it('requires explicit approval when command is not pre-approved', () => {
    const result = evaluateCommandPolicy({
      projectRoot,
      config: makeConfig(),
      task: makeTask(),
      agent: makeAgent({ allowedPaths: ['src'] }),
      request: makeRequest({ command: 'npm test', cwd: 'src' }),
    });

    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(true);
    expect(result.preApproved).toBe(false);
  });

  it('bypasses approval for pre-approved commands after policy checks pass', () => {
    const result = evaluateCommandPolicy({
      projectRoot,
      config: makeConfig(),
      task: makeTask(),
      agent: makeAgent({
        allowedPaths: ['src'],
        preApprovedCommands: ['npm test'],
      }),
      request: makeRequest({ command: 'npm test -- --runInBand', cwd: 'src' }),
    });

    expect(result.allowed).toBe(true);
    expect(result.preApproved).toBe(true);
    expect(result.requiresApproval).toBe(false);
  });

  it('denies execution in worktree mode when task has no sandbox path', () => {
    const result = evaluateCommandPolicy({
      projectRoot,
      config: makeConfig({
        sandbox: {
          defaultMode: 'worktree',
          useWorktrees: true,
        },
      }),
      task: makeTask({ sandboxPath: undefined }),
      agent: makeAgent(),
      request: makeRequest(),
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('sandbox path');
  });
});
