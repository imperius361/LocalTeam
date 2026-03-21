import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Agent } from '../src/agent';
import * as providerFactory from '../src/providers/factory';
import { LocalTeamRuntime } from '../src/runtime';
import type { IpcNotification } from '../src/protocol';
import type { ProjectConfig } from '../src/types';
import { createGitWorkspace } from './helpers';

const config: ProjectConfig = {
  team: {
    name: 'Runtime Team',
    agents: [
      {
        id: 'architect',
        role: 'Software Architect',
        model: 'mock',
        provider: 'mock',
        systemPrompt: 'Plan the work.',
        canExecuteCommands: true,
      },
      {
        id: 'security',
        role: 'Security Engineer',
        model: 'mock',
        provider: 'mock',
        systemPrompt: 'Review security.',
        canExecuteCommands: true,
      },
      {
        id: 'engineer',
        role: 'Backend Engineer',
        model: 'mock',
        provider: 'mock',
        systemPrompt: 'Implement features.',
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

describe('LocalTeamRuntime manager review flow and streaming notifications', () => {
  it('moves a root request into review before creating agent subtasks, then creates subtasks after approval', async () => {
    const root = await createGitWorkspace('localteam-runtime-');
    const notifications: IpcNotification[] = [];
    const runtime = new LocalTeamRuntime((notification) => {
      notifications.push(notification);
    });

    try {
      vi.spyOn(providerFactory, 'createAgent').mockImplementation((agentConfig) => ({
        agent: new Agent(agentConfig, {
          id: 'mock',
          name: 'Mock',
          async *sendMessage() {
            yield 'AGREE: plan approved for manager review';
          },
        } as any),
        hasCredentials: true,
      }));

      await runtime.loadProject(root);
      await runtime.saveProject(config);
      await runtime.startSession();
      const snapshot = await runtime.createTask(
        'Add authentication and hardening',
        'Implement login flow, authorization checks, and validation coverage.',
      );
      const rootTask = snapshot.tasks[snapshot.tasks.length - 1];
      expect(rootTask).toBeTruthy();
      expect(rootTask.assignedAgents.length).toBeGreaterThan(0);
      expect(rootTask.assignedAgents.length).toBeLessThan(config.team.agents.length);

      await waitFor(async () => {
        const tasks = await runtime.listTasks();
        return tasks.some((task) => task.id === rootTask.id && task.status === 'review');
      }, 2_000);

      const reviewedRoot = (await runtime.listTasks()).find((task) => task.id === rootTask.id);
      expect(reviewedRoot?.reviewSummary?.summaryText).toContain('Manager review');
      expect(
        (await runtime.listTasks()).filter((task) => task.parentTaskId === rootTask.id),
      ).toHaveLength(0);

      await waitFor(async () => {
        return notifications.some((entry) => entry.method === 'v1.session.message.finalized');
      }, 2_000);

      expect(
        notifications.some((entry) => entry.method === 'v1.session.message.delta'),
      ).toBe(true);
      expect(
        notifications.some((entry) => entry.method === 'v1.session.message.finalized'),
      ).toBe(true);

      await runtime.respondToTaskReview(rootTask.id, 'approve');

      await waitFor(async () => {
        const latest = await runtime.listTasks();
        return latest.some((task) => task.parentTaskId === rootTask.id);
      }, 2_000);

      const tasks = await runtime.listTasks();
      const subtasks = tasks.filter((task) => task.parentTaskId === rootTask.id);
      expect(subtasks.length).toBeGreaterThan(0);
      for (const subtask of subtasks) {
        expect(subtask.assignedAgents.length).toBeGreaterThan(0);
        expect(subtask.assignedAgents.length).toBe(1);
        expect(subtask.origin).toBe('agent_subtask');
        expect(subtask.createdByAgentId).toBe(rootTask.managerAgentId ?? 'architect');
      }

      const latestRoot = tasks.find((task) => task.id === rootTask.id);
      expect(['in_progress', 'completed', 'review']).toContain(latestRoot?.status ?? 'pending');
    } finally {
      runtime.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('resolves nested selections to the git workspace root', async () => {
    const root = await createGitWorkspace('localteam-runtime-nested-');
    const nestedPath = join(root, 'nested', 'folder');
    await mkdir(nestedPath, { recursive: true });
    const runtime = new LocalTeamRuntime(() => {});

    try {
      const snapshot = await runtime.loadProject(nestedPath);
      await runtime.saveProject(config);

      expect(snapshot.projectRoot).toBe(root);
      expect((await runtime.status()).projectRoot).toBe(root);
    } finally {
      runtime.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('emits v1.snapshot notifications for workspace load and save', async () => {
    const root = await createGitWorkspace('localteam-runtime-snapshot-');
    const notifications: IpcNotification[] = [];
    const runtime = new LocalTeamRuntime((notification) => {
      notifications.push(notification);
    });

    try {
      await runtime.loadProject(root);
      await runtime.saveProject(config);

      const snapshots = notifications.filter((entry) => entry.method === 'v1.snapshot');
      expect(snapshots.length).toBeGreaterThanOrEqual(2);
      expect((snapshots[0]?.params.snapshot as any)?.projectRoot).toBe(root);
      expect((snapshots[snapshots.length - 1]?.params.snapshot as any)?.config?.team?.name).toBe(
        'Runtime Team',
      );
    } finally {
      runtime.dispose();
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
