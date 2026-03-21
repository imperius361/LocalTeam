import { rm } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Agent } from '../src/agent';
import * as providerFactory from '../src/providers/factory';
import { LocalTeamRuntime } from '../src/runtime';
import type { ProjectConfig } from '../src/types';
import { createGitWorkspace } from './helpers';

type PromptCapture = {
  messages: Array<{ role: string; content: string }>;
  systemPrompt: string;
  model: string;
};

const baseConfig: ProjectConfig = {
  team: {
    name: 'Interjection Team',
    agents: [
      {
        id: 'architect',
        role: 'Software Architect',
        model: 'mock',
        provider: 'mock',
        systemPrompt: 'Lead the discussion.',
        canExecuteCommands: false,
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

describe('LocalTeamRuntime task interjection', () => {
  it('reruns a review task with guidance and preserves history', async () => {
    const root = await createGitWorkspace('localteam-interject-completed-');
    const prompts: PromptCapture[] = [];
    const runtime = new LocalTeamRuntime(() => {});

    try {
      const createAgentSpy = vi.spyOn(providerFactory, 'createAgent');
      createAgentSpy.mockImplementation((agentConfig) => ({
        agent: new Agent(agentConfig, {
          id: 'mock',
          name: 'Mock',
          async *sendMessage(params) {
            prompts.push({
              messages: params.messages.map((message) => ({ ...message })),
              systemPrompt: params.systemPrompt,
              model: params.model,
            });
            yield prompts.length === 1
              ? 'AGREE: initial run'
              : 'AGREE: updated after user guidance';
          },
        } as any),
        hasCredentials: true,
      }));

      await runtime.loadProject(root);
      await runtime.saveProject(baseConfig);
      await runtime.startSession();
      const snapshot = await runtime.createTask(
        'Build auth',
        'Start with a single live pass.',
      );
      const taskId = snapshot.tasks[snapshot.tasks.length - 1].id;

      await waitFor(async () => {
        const task = (await runtime.status()).tasks.find((entry) => entry.id === taskId);
        return task?.status === 'review';
      }, 2_000);

      const rerun = await runtime.interjectTask(taskId, 'Please tighten the auth boundary.');
      expect(rerun.tasks.find((entry) => entry.id === taskId)).toBeTruthy();

      await waitFor(async () => prompts.length >= 2, 5_000);
      await waitFor(async () => {
        const task = (await runtime.status()).tasks.find((entry) => entry.id === taskId);
        return task?.status === 'review';
      }, 5_000);

      const messages = await runtime.listMessages(taskId);
      expect(messages.some((message) => message.type === 'user')).toBe(true);
      const completedUserMessages = messages.filter((message) => message.type === 'user');
      expect(completedUserMessages[completedUserMessages.length - 1]?.content).toBe(
        'Please tighten the auth boundary.',
      );
      expect(
        prompts.some((prompt) =>
          prompt.messages.at(-1)?.content.includes('Please tighten the auth boundary.'),
        ),
      ).toBe(true);
    } finally {
      runtime.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('queues guidance on a live task and feeds it into the next round', async () => {
    const root = await createGitWorkspace('localteam-interject-live-');
    const prompts: PromptCapture[] = [];
    const runtime = new LocalTeamRuntime(() => {});
    let releaseBlockedAgent!: () => void;
    const blockedAgentGate = new Promise<void>((resolve) => {
      releaseBlockedAgent = resolve;
    });

    const config: ProjectConfig = {
      team: {
        name: 'Live Guidance Team',
        agents: [
          {
            id: 'architect',
            role: 'Software Architect',
            model: 'mock',
            provider: 'mock',
            systemPrompt: 'Lead the discussion.',
            canExecuteCommands: false,
          },
          {
            id: 'security',
            role: 'Security Engineer',
            model: 'mock',
            provider: 'mock',
            systemPrompt: 'Review the security boundary.',
            canExecuteCommands: false,
          },
          {
            id: 'engineer',
            role: 'Implementation Engineer',
            model: 'mock',
            provider: 'mock',
            systemPrompt: 'Turn the plan into execution-ready steps.',
            canExecuteCommands: false,
          },
        ],
      },
      consensus: {
        maxRounds: 2,
        requiredMajority: 1,
      },
      sandbox: {
        defaultMode: 'direct',
        useWorktrees: false,
      },
      fileAccess: {
        denyList: ['.env', '.ssh/', 'credentials*'],
      },
    };

    try {
      let callIndex = 0;
      vi.spyOn(providerFactory, 'createAgent').mockImplementation((agentConfig) => ({
        agent: new Agent(agentConfig, {
          id: 'mock',
          name: 'Mock',
          async *sendMessage(params) {
            callIndex += 1;
            prompts.push({
              messages: params.messages.map((message) => ({ ...message })),
              systemPrompt: params.systemPrompt,
              model: params.model,
            });

            if (callIndex === 1) {
              yield 'OBJECTION: initial concerns';
              return;
            }

            if (callIndex === 2) {
              yield 'OBJECTION: waiting for user guidance';
              await blockedAgentGate;
              return;
            }

            yield 'AGREE: updated with the new guidance';
          },
        } as any),
        hasCredentials: true,
      }));

      await runtime.loadProject(root);
      await runtime.saveProject(config);
      await runtime.startSession();
      const snapshot = await runtime.createTask(
        'Architecture and security plan',
        'Design the auth boundary, hardening path, and review process.',
      );
      const taskId = snapshot.tasks[snapshot.tasks.length - 1].id;
      expect(snapshot.tasks[snapshot.tasks.length - 1].assignedAgents).toHaveLength(1);

      await waitFor(async () => prompts.length >= 2, 5_000);
      const interjectionPromise = runtime.interjectTask(
        taskId,
        'Bias the next round toward least privilege.',
      );
      await interjectionPromise;
      releaseBlockedAgent();

      await waitFor(async () => prompts.length >= 4, 10_000);
      await waitFor(async () => {
        const task = (await runtime.status()).tasks.find((entry) => entry.id === taskId);
        return task?.status === 'review';
      }, 5_000);

      const latest = await runtime.status();
      const task = latest.tasks.find((entry) => entry.id === taskId);
      expect(task?.status).toBe('review');

      const messages = await runtime.listMessages(taskId);
      expect(messages.some((message) => message.type === 'user')).toBe(true);
      const guidanceMessages = messages.filter((message) => message.type === 'user');
      expect(guidanceMessages[guidanceMessages.length - 1]?.content).toBe(
        'Bias the next round toward least privilege.',
      );
      expect(prompts.some((prompt) =>
        prompt.messages.at(-1)?.content.includes('Bias the next round toward least privilege.'),
      )).toBe(true);
      expect(prompts[2].messages.at(-1)?.content).toContain(
        'Bias the next round toward least privilege.',
      );
    } finally {
      runtime.dispose();
      releaseBlockedAgent?.();
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
