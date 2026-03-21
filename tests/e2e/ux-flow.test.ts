import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CredentialOnboardingPrompt } from '../../src/components/CredentialOnboardingPrompt';
import { CredentialsSummaryPanel } from '../../src/components/CredentialsSummaryPanel';
import { ProjectSettingsPanel } from '../../src/components/ProjectSettingsPanel';
import type { ProjectConfig } from '../../src/lib/contracts';
import { resolveWorkspaceConfigPath } from '../../src-sidecar/src/persistence';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sidecarDir = join(__dirname, '..', '..', 'src-sidecar');

async function createGitWorkspace(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const result = spawnSync('git', ['init'], {
    cwd: root,
    stdio: 'ignore',
  });

  if (result.status !== 0) {
    throw new Error(`git init failed for ${root}`);
  }

  return root;
}

function makeProjectConfig(teamName: string): ProjectConfig {
  return {
    team: {
      name: teamName,
      agents: [
        {
          id: 'architect',
          role: 'Software Architect',
          model: 'mock',
          provider: 'mock',
          systemPrompt: 'Lead the discussion.',
          canExecuteCommands: true,
          allowedPaths: ['.'],
        },
      ],
    },
    consensus: {
      maxRounds: 2,
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
}

interface IpcEnvelope {
  id?: string;
  method?: string;
  result?: unknown;
  error?: { message?: string };
  params?: Record<string, unknown>;
}

interface NotificationRecord {
  payload: IpcEnvelope;
  receivedAt: number;
}

interface ResponseWaiter {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

interface NotificationWaiter {
  method: string;
  predicate: (payload: IpcEnvelope) => boolean;
  resolve: (record: NotificationRecord) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

class SidecarHarness {
  private child: ChildProcess;
  private sequence = 0;
  private stdoutBuffer = '';
  private responseWaiters = new Map<string, ResponseWaiter>();
  private notificationWaiters: NotificationWaiter[] = [];
  private notifications: NotificationRecord[] = [];

  private constructor(child: ChildProcess) {
    this.child = child;
    this.child.stdout?.on('data', (chunk: Buffer) => {
      this.stdoutBuffer += chunk.toString();
      const lines = this.stdoutBuffer.split('\n');
      this.stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }
        this.consumeLine(trimmed);
      }
    });
  }

  static async start(appDataDir: string): Promise<SidecarHarness> {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: sidecarDir,
      env: {
        ...process.env,
        LOCALTEAM_APP_DATA_DIR: appDataDir,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Sidecar start timeout')), 10000);
      child.stderr?.on('data', (chunk: Buffer) => {
        if (chunk.toString().includes('started')) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error(`Sidecar exited during startup (${String(code)})`));
      });
    });

    return new SidecarHarness(child);
  }

  stop(): void {
    this.child.kill();
    for (const waiter of this.responseWaiters.values()) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error('Sidecar stopped'));
    }
    this.responseWaiters.clear();
    for (const waiter of this.notificationWaiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error('Sidecar stopped'));
    }
    this.notificationWaiters = [];
  }

  request(method: string, params: Record<string, unknown> = {}): Promise<any> {
    const id = `req-${Date.now()}-${this.sequence += 1}`;
    const message = JSON.stringify({ id, method, params }) + '\n';

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.responseWaiters.delete(id);
        reject(new Error(`Timeout waiting for ${method}`));
      }, 8000);
      this.responseWaiters.set(id, { resolve, reject, timeout });
      this.child.stdin?.write(message);
    });
  }

  waitForNotification(
    method: string,
    predicate: (payload: IpcEnvelope) => boolean = () => true,
    timeoutMs = 12000,
  ): Promise<NotificationRecord> {
    const existingIndex = this.notifications.findIndex(
      (entry) => entry.payload.method === method && predicate(entry.payload),
    );
    if (existingIndex >= 0) {
      const [existing] = this.notifications.splice(existingIndex, 1);
      return Promise.resolve(existing);
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.notificationWaiters = this.notificationWaiters.filter(
          (waiter) => waiter.resolve !== resolve,
        );
        reject(new Error(`Timeout waiting for notification ${method}`));
      }, timeoutMs);

      this.notificationWaiters.push({
        method,
        predicate,
        resolve,
        reject,
        timeout,
      });
    });
  }

  private consumeLine(line: string): void {
    const payload = JSON.parse(line) as IpcEnvelope;
    if (payload.id) {
      const waiter = this.responseWaiters.get(payload.id);
      if (!waiter) {
        return;
      }
      this.responseWaiters.delete(payload.id);
      clearTimeout(waiter.timeout);
      if (payload.error) {
        waiter.reject(new Error(payload.error.message ?? 'Unknown sidecar error'));
      } else {
        waiter.resolve(payload.result);
      }
      return;
    }

    const record: NotificationRecord = {
      payload,
      receivedAt: Date.now(),
    };
    this.notifications.push(record);
    this.flushNotificationWaiters();
  }

  private flushNotificationWaiters(): void {
    const pending: NotificationWaiter[] = [];
    for (const waiter of this.notificationWaiters) {
      const matchIndex = this.notifications.findIndex(
        (entry) =>
          entry.payload.method === waiter.method && waiter.predicate(entry.payload),
      );
      if (matchIndex >= 0) {
        const [match] = this.notifications.splice(matchIndex, 1);
        clearTimeout(waiter.timeout);
        waiter.resolve(match);
      } else {
        pending.push(waiter);
      }
    }
    this.notificationWaiters = pending;
  }
}

describe('UX flow assumptions (streaming + task hierarchy)', () => {
  let harness: SidecarHarness;
  let appDataDir: string;

  beforeAll(async () => {
    appDataDir = await mkdtemp(join(tmpdir(), 'localteam-e2e-app-data-'));
    process.env.LOCALTEAM_APP_DATA_DIR = appDataDir;
    harness = await SidecarHarness.start(appDataDir);
  });

  afterAll(async () => {
    harness.stop();
    delete process.env.LOCALTEAM_APP_DATA_DIR;
    await rm(appDataDir, { recursive: true, force: true });
  });

  it('supports parent and subtask linking in task snapshots', async () => {
    const root = await createGitWorkspace('localteam-e2e-parent-child-');
    const runId = Date.now();
    const parentTitle = `UX parent task ${runId}`;
    const childTitle = `UX child task ${runId}`;

    try {
      await harness.request('v1.project.load', { rootPath: root });
      await harness.request('v1.project.save', {
        config: makeProjectConfig('Parent Child Team'),
      });
      await harness.request('v1.session.start');

      const parentSnapshot = await harness.request('v1.task.create', {
        title: parentTitle,
        description: 'Validate parent task visibility in UI task flow.',
      });
      const parentTask = (parentSnapshot.tasks as any[]).find(
        (task) => task.title === parentTitle,
      );
      expect(parentTask).toBeDefined();
      expect(parentTask.assignedAgents.length).toBeGreaterThan(0);

      const childSnapshot = await harness.request('v1.task.create', {
        title: childTitle,
        description: 'Validate subtask visibility and linkage.',
        parentTaskId: parentTask.id,
      });
      const childTask = (childSnapshot.tasks as any[]).find(
        (task) => task.title === childTitle,
      );
      expect(childTask).toBeDefined();
      expect(childTask.parentTaskId).toBe(parentTask.id);

      const listedTasks = await harness.request('v1.task.list');
      const listedChild = (listedTasks as any[]).find((task) => task.id === childTask.id);
      expect(listedChild.parentTaskId).toBe(parentTask.id);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('emits streaming deltas before final message completion for active tasks', async () => {
    const root = await createGitWorkspace('localteam-e2e-stream-');
    const runId = Date.now();
    const title = `UX stream task ${runId}`;
    try {
      await harness.request('v1.project.load', { rootPath: root });
      await harness.request('v1.project.save', {
        config: makeProjectConfig('Streaming Team'),
      });
      await harness.request('v1.session.start');

      const snapshot = await harness.request('v1.task.create', {
        title,
        description: 'Validate live streaming visibility assumptions in UI.',
      });
      const task = (snapshot.tasks as any[]).find((entry) => entry.title === title);
      expect(task).toBeDefined();

      const taskProgress = await harness.waitForNotification(
        'v1.task.updated',
        (event) =>
          event.params?.task &&
          (event.params.task as any).id === task.id &&
          (event.params.task as any).status === 'in_progress',
      );
      const activeAgent = await harness.waitForNotification(
        'v1.agent.updated',
        (event) => {
          const status = (event.params?.agent as any)?.status;
          return status === 'thinking' || status === 'writing';
        },
      );
      const delta = await harness.waitForNotification(
        'v1.session.message.delta',
        (event) => {
          const payload = event.params?.delta as any;
          return payload?.taskId === task.id && typeof payload?.delta === 'string';
        },
      );
      const message = await harness.waitForNotification(
        'v1.session.message',
        (event) => {
          const payload = event.params?.message as any;
          return payload?.taskId === task.id && typeof payload?.content === 'string';
        },
      );
      const finalization = await harness.waitForNotification(
        'v1.session.message.finalized',
        (event) => {
          const payload = event.params?.finalization as any;
          return payload?.messageId === (delta.payload.params?.delta as any)?.messageId;
        },
      );

      expect(taskProgress.receivedAt).toBeLessThanOrEqual(message.receivedAt);
      expect(delta.receivedAt).toBeLessThanOrEqual(message.receivedAt);
      expect(activeAgent.receivedAt).toBeLessThanOrEqual(message.receivedAt);
      expect(finalization.receivedAt).toBeGreaterThanOrEqual(delta.receivedAt);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('renders workspace-based project settings without raw JSON editing controls', () => {
    const markup = renderToStaticMarkup(
      createElement(ProjectSettingsPanel, {
        currentRoot: 'C:\\Repositories\\LocalTeam',
        onChooseWorkspace: () => {},
        onReloadWorkspace: () => {},
        loading: false,
        busy: false,
        error: null,
        config: makeProjectConfig('UI Settings Team'),
      }),
    );

    expect(markup).toContain('Git workspace');
    expect(markup).toContain('LocalTeam stores its own settings and runtime state in app data.');
    expect(markup).toContain('Choose Git Workspace');
    expect(markup).toContain('Reload Workspace');
    expect(markup).not.toContain('<textarea');
    expect(markup).not.toContain('Save Project Config');
    expect(markup).not.toContain('localteam.json');
  });

  it('renders the first-run API key prompt as a simple settings redirect', () => {
    const markup = renderToStaticMarkup(
      createElement(CredentialOnboardingPrompt, {
        onOpenSettings: () => {},
        onSkip: () => {},
      }),
    );

    expect(markup).toContain('Set up agent API keys');
    expect(markup).toContain('Continue without keys');
    expect(markup).toContain('Open Settings');
    expect(markup).not.toContain('OpenAI API key');
    expect(markup).not.toContain('Anthropic API key');
  });

  it('renders key status as a summary panel instead of inline credential inputs', () => {
    const markup = renderToStaticMarkup(
      createElement(CredentialsSummaryPanel, {
        credentialRows: [
          {
            provider: 'openai',
            hasStoredKey: true,
            hasRuntimeKey: false,
            required: true,
          },
          {
            provider: 'anthropic',
            hasStoredKey: false,
            hasRuntimeKey: false,
            required: false,
          },
        ],
        statusLabel: 'Locked • keys saved',
        vaultUnlocked: false,
        onOpenSettings: () => {},
        onLockVault: () => {},
      }),
    );

    expect(markup).toContain('Agent API Keys');
    expect(markup).toContain('Open Settings');
    expect(markup).not.toContain('OpenAI API key');
    expect(markup).not.toContain('Unlock Vault');
  });

  it('loads a git workspace and saves LocalTeam settings in app data', async () => {
    const root = await createGitWorkspace('localteam-ui-project-');

    try {
      const originalConfig = makeProjectConfig('UI Settings Team');
      await writeFile(
        join(root, 'localteam.json'),
        JSON.stringify(originalConfig, null, 2) + '\n',
        'utf8',
      );

      const loaded = await harness.request('v1.project.load', { rootPath: root });
      expect((loaded as any).projectRoot).toBe(root);
      expect((loaded as any).config.team.name).toBe('UI Settings Team');

      const updatedConfig: ProjectConfig = {
        ...originalConfig,
        team: {
          ...originalConfig.team,
          name: 'UI Settings Team Updated',
        },
        consensus: {
          ...originalConfig.consensus,
          maxRounds: 3,
        },
      };

      const saved = await harness.request('v1.project.save', { config: updatedConfig });
      expect((saved as any).config.team.name).toBe('UI Settings Team Updated');

      const onDisk = JSON.parse(
        await readFile(resolveWorkspaceConfigPath(root), 'utf8'),
      ) as ProjectConfig;
      expect(onDisk.team.name).toBe('UI Settings Team Updated');
      expect(onDisk.consensus.maxRounds).toBe(3);
      await expect(access(join(root, '.localteam', 'localteam.db'))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('queues command approvals and allows approve/deny resolution', async () => {
    const root = await createGitWorkspace('localteam-ui-approval-');

    try {
      await harness.request('v1.project.load', { rootPath: root });
      await harness.request('v1.project.save', {
        config: makeProjectConfig('Approval Team'),
      });
      await harness.request('v1.session.start');
      const created = await harness.request('v1.task.create', {
        title: 'Approval task',
        description: 'Trigger an approval-gated command.',
      });
      const task = (created as any).tasks.find((entry: any) => entry.title === 'Approval task');
      expect(task).toBeDefined();

      const pending = await harness.request('v1.command.execute', {
        taskId: task.id,
        agentId: task.assignedAgents[0],
        command: 'echo approval-flow',
        cwd: '.',
      });
      expect((pending as any).status).toBe('pending');
      expect((pending as any).requiresApproval).toBe(true);

      const approvals = (await harness.request('v1.command.approval.list', {
        taskId: task.id,
      })) as any[];
      const pendingApproval = approvals.find((approval) => approval.id === (pending as any).id);
      expect(pendingApproval).toBeDefined();
      expect(pendingApproval.status).toBe('pending');

      const approved = await harness.request('v1.command.approval.resolve', {
        approvalId: pendingApproval.id,
        action: 'approve',
      });
      expect((approved as any).status).toBe('completed');
      expect(String((approved as any).stdout ?? '')).toContain('approval-flow');

      const deniedRequest = await harness.request('v1.command.execute', {
        taskId: task.id,
        agentId: task.assignedAgents[0],
        command: 'echo deny-flow',
        cwd: '.',
      });
      const denied = await harness.request('v1.command.approval.resolve', {
        approvalId: (deniedRequest as any).id,
        action: 'deny',
      });
      expect((denied as any).status).toBe('denied');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
