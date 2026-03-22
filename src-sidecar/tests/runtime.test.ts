import { rm } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalTeamRuntime } from '../src/runtime';
import type { IpcNotification } from '../src/protocol';
import type { ProjectConfig } from '../src/types';
import { createGitWorkspace } from './helpers';

const config: ProjectConfig = {
  version: 2,
  defaultTeamId: 'runtime-team',
  teams: [
    {
      id: 'runtime-team',
      name: 'Runtime Team',
      workspaceMode: 'shared_project',
      members: [
        {
          id: 'architect',
          role: 'Software Architect',
          runtimeProfileRef: 'profiles/runtime-architect',
          runtimeHint: {
            provider: 'nemoclaw',
            model: 'openclaw-local',
          },
          systemPrompt: 'Plan the work.',
          canExecuteCommands: true,
        },
        {
          id: 'security',
          role: 'Security Engineer',
          runtimeProfileRef: 'profiles/runtime-security',
          runtimeHint: {
            provider: 'nemoclaw',
            model: 'openclaw-hosted',
          },
          systemPrompt: 'Review security.',
          canExecuteCommands: true,
        },
        {
          id: 'engineer',
          role: 'Backend Engineer',
          runtimeProfileRef: 'profiles/runtime-engineer',
          runtimeHint: {
            provider: 'nemoclaw',
            model: 'openclaw-local',
          },
          systemPrompt: 'Implement features.',
          canExecuteCommands: true,
        },
      ],
    },
  ],
  consensus: {
    maxRounds: 1,
    requiredMajority: 0.5,
  },
  sandbox: {
    defaultMode: 'direct',
    useWorktrees: false,
  },
  fileAccess: {
    denyList: ['.env', '.ssh/', 'credentials*'],
  },
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('LocalTeamRuntime Nemoclaw/OpenClaw bridge', () => {
  it('loads and saves a workspace while keeping project selection intact', async () => {
    const root = await createGitWorkspace('localteam-runtime-');
    const notifications: IpcNotification[] = [];
    const runtime = new LocalTeamRuntime((notification) => {
      notifications.push(notification);
    });

    try {
      await runtime.loadProject(root);
      const saved = await runtime.saveProject(config);
      expect(saved.projectRoot).toBe(root);
      expect(saved.config?.teams).toHaveLength(1);
      expect((await runtime.status()).projectRoot).toBe(root);
      expect(notifications.some((entry) => entry.method === 'v1.snapshot')).toBe(true);
    } finally {
      runtime.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('starts and stops Nemoclaw-backed sessions', async () => {
    const root = await createGitWorkspace('localteam-runtime-nested-');
    const runtime = new LocalTeamRuntime(() => {});

    try {
      await runtime.loadProject(root);
      await runtime.saveProject(config);
      const started = await runtime.startSession('runtime-team');
      expect(started.session?.status).toBe('running');
      expect(started.session?.teamId).toBe('runtime-team');
      expect(started.agentStatuses).toHaveLength(3);
      expect(started.commandApprovals.length).toBeGreaterThan(0);
      expect(
        started.messages.some((message) => message.agentId === 'architect'),
      ).toBe(true);

      const stopped = await runtime.stopSession();
      expect(stopped.session?.status).toBe('idle');
      expect(stopped.messages.length).toBeGreaterThan(0);
    } finally {
      runtime.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports Nemoclaw gateway status and profiles', async () => {
    const root = await createGitWorkspace('localteam-runtime-snapshot-');
    const runtime = new LocalTeamRuntime(() => {});

    try {
      await runtime.loadProject(root);
      await runtime.saveProject(config);
      const status = await runtime.getNemoclawStatus();
      expect((status.gateway as any).ready).toBe(false);
      expect(status.activeTeamId).toBe('runtime-team');
      expect(Array.isArray(status.runtimeProfiles)).toBe(true);
    } finally {
      runtime.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
});
