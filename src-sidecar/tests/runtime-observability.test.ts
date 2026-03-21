import { rm } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IpcNotification } from '../src/protocol';
import type { ProjectConfig } from '../src/types';
import { createGitWorkspace } from './helpers';

const baseConfig: ProjectConfig = {
  team: {
    name: 'Runtime Observability Team',
    agents: [
      {
        id: 'architect',
        role: 'Software Architect',
        model: 'mock',
        provider: 'mock',
        systemPrompt: 'Plan the work.',
        canExecuteCommands: true,
      },
    ],
  },
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

describe('LocalTeamRuntime failure observability', () => {
  it('surfaces provider failures during startup as system messages and review state', async () => {
    const root = await createGitWorkspace('localteam-runtime-provider-failure-');
    const notifications: IpcNotification[] = [];

    try {
      const providerFactory = await import('../src/providers/factory.js');
      const { Agent } = await import('../src/agent.js');
      vi.spyOn(providerFactory, 'createAgent').mockImplementation((agentConfig) => ({
        agent: new Agent(
          agentConfig,
          {
            id: 'failing',
            name: 'Failing',
            async *sendMessage() {
              throw new Error('Simulated provider outage');
            },
          } as any,
        ),
        hasCredentials: true,
      }));

      const { LocalTeamRuntime } = await import('../src/runtime.js');
      const runtime = new LocalTeamRuntime((notification) => {
        notifications.push(notification);
      });

      await runtime.loadProject(root);
      await runtime.saveProject(baseConfig);
      await runtime.startSession();
      const snapshot = await runtime.createTask(
        'Start a discussion',
        'Kick off the panel and collect a first response.',
      );
      const taskId = snapshot.tasks[snapshot.tasks.length - 1].id;

      await waitFor(async () => {
        const tasks = await runtime.listTasks();
        return tasks.some((task) => task.id === taskId && task.status === 'review');
      }, 2_000);
      await waitFor(async () => {
        return notifications.some(
          (notification) =>
            notification.method === 'v1.shell.notification' &&
            notification.params.title === 'Task moved to review',
        );
      }, 2_000);

      const taskMessages = await runtime.listMessages(taskId);
      const failureMessage = taskMessages.find((message) => message.type === 'system');
      expect(failureMessage?.content).toContain('task decomposition');
      expect(failureMessage?.content).toContain('Simulated provider outage');

      const latest = await runtime.status();
      const task = latest.tasks.find((entry) => entry.id === taskId);
      const agent = latest.agentStatuses.find((entry) => entry.agentId === 'architect');

      expect(task?.status).toBe('review');
      expect(latest.session?.status).toBe('awaiting_user');
      expect(agent?.lastError).toBe('Simulated provider outage');
      expect(
        notifications.some(
          (notification) =>
            notification.method === 'v1.shell.notification' &&
            notification.params.title === 'Task moved to review',
        ),
      ).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('surfaces worktree setup failures without leaving a stale sandbox path', async () => {
    const root = await createGitWorkspace('localteam-runtime-worktree-failure-');
    const notifications: IpcNotification[] = [];
    const config: ProjectConfig = {
      ...baseConfig,
      sandbox: {
        defaultMode: 'worktree',
        useWorktrees: true,
      },
    };

    try {
      const { LocalTeamRuntime } = await import('../src/runtime.js');
      const runtime = new LocalTeamRuntime((notification) => {
        notifications.push(notification);
      });

      await runtime.loadProject(root);
      await runtime.saveProject(config);
      await runtime.startSession();
      const snapshot = await runtime.createTask(
        'Prepare a sandboxed task',
        'Attempt startup with worktree isolation enabled.',
      );
      const taskId = snapshot.tasks[snapshot.tasks.length - 1].id;

      await waitFor(async () => {
        return notifications.some(
          (notification) =>
            notification.method === 'v1.shell.notification' &&
            notification.params.title === 'Worktree setup failed',
        );
      }, 2_000);

      const latest = await runtime.status();
      const task = latest.tasks.find((entry) => entry.id === taskId);
      const worktreeMessage = latest.messages.find(
        (message) =>
          message.taskId === taskId &&
          message.type === 'system' &&
          message.content.includes('could not prepare a worktree'),
      );

      expect(task?.sandboxPath).toBeUndefined();
      expect(task?.sandboxDiffStat).toBeUndefined();
      expect(worktreeMessage).toBeTruthy();
      await waitFor(async () => {
        const tasks = await runtime.listTasks();
        return tasks.some(
          (entry) => entry.id === taskId && entry.status !== 'in_progress',
        );
      }, 2_000);
      await new Promise((resolve) => setTimeout(resolve, 150));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function waitFor(
  check: () => Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) {
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}
