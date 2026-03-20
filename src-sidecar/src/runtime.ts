import { randomUUID } from 'node:crypto';
import { watch } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { ConsensusProtocol } from './consensus.js';
import { MessageBus } from './message-bus.js';
import { Orchestrator } from './orchestrator.js';
import { ProjectDatabase } from './persistence.js';
import type { IpcNotification } from './protocol.js';
import { createAgent } from './providers/factory.js';
import { TaskManager } from './task-manager.js';
import {
  parseProjectConfig,
  validateProjectConfig,
} from './team-config.js';
import type {
  AgentConfig,
  AgentMessage,
  AgentStatus,
  ConsensusState,
  ProjectConfig,
  ProjectSnapshot,
  ProviderCredentialStatus,
  ProviderId,
  SessionState,
  Task,
  TemplateSummary,
} from './types.js';

const DEFAULT_PROJECT_FILE = 'localteam.json';
const DEFAULT_VERSION = '0.2.0';

export class LocalTeamRuntime {
  private readonly startedAt = Date.now();
  private readonly messageBus = new MessageBus();
  private readonly orchestrator = new Orchestrator(this.messageBus);
  private readonly taskManager = new TaskManager();
  private readonly credentials = new Map<ProviderId, string>();
  private readonly agentStatuses = new Map<string, AgentStatus>();
  private readonly consensusStates = new Map<string, ConsensusState>();
  private readonly templatesDir = resolve(process.cwd(), 'templates');

  private projectRoot: string | null = null;
  private config: ProjectConfig | null = null;
  private session: SessionState | null = null;
  private database: ProjectDatabase | null = null;
  private projectWatcher?: ReturnType<typeof watch>;
  private lastError?: string;

  constructor(
    private readonly notify: (notification: IpcNotification) => void,
  ) {
    this.messageBus.on('message', (message) => {
      void this.database?.saveMessage(message);
      this.notify({
        method: 'v1.session.message',
        params: { message },
      });
    });
  }

  async status(): Promise<ProjectSnapshot> {
    return this.getSnapshot();
  }

  async loadProject(rootPath = process.cwd()): Promise<ProjectSnapshot> {
    const projectRoot = await resolveProjectRoot(rootPath);
    const configPath = join(projectRoot, DEFAULT_PROJECT_FILE);
    const raw = await readFile(configPath, 'utf8');
    const config = parseProjectConfig(raw);
    const errors = validateProjectConfig(config);
    if (errors.length > 0) {
      throw new Error(`Invalid localteam.json: ${errors.join('; ')}`);
    }

    this.projectRoot = projectRoot;
    this.config = config;
    this.database = await ProjectDatabase.open(projectRoot);

    const state = await this.database.loadState();
    this.messageBus.hydrate(state.messages);
    this.taskManager.hydrate(state.tasks);
    this.consensusStates.clear();
    state.consensus.forEach((entry) => {
      this.consensusStates.set(entry.taskId, entry);
    });
    this.session = state.session;

    this.rebuildAgents();
    this.startProjectWatcher(projectRoot);
    return this.getSnapshot();
  }

  async saveProject(config: ProjectConfig): Promise<ProjectSnapshot> {
    const errors = validateProjectConfig(config);
    if (errors.length > 0) {
      throw new Error(`Invalid localteam.json: ${errors.join('; ')}`);
    }

    const projectRoot = this.projectRoot ?? resolve(process.cwd());
    await writeFile(
      join(projectRoot, DEFAULT_PROJECT_FILE),
      JSON.stringify(config, null, 2) + '\n',
      'utf8',
    );
    return this.loadProject(projectRoot);
  }

  async listTemplates(): Promise<TemplateSummary[]> {
    return this.refreshTemplates();
  }

  async getTemplate(id: string): Promise<ProjectConfig> {
    const raw = await readFile(join(this.templatesDir, `${id}.json`), 'utf8');
    const template = JSON.parse(raw) as {
      name: string;
      agents: AgentConfig[];
      description?: string;
    };

    return {
      team: {
        name: template.name,
        agents: template.agents,
      },
      consensus: this.config?.consensus ?? {
        maxRounds: 3,
        requiredMajority: 0.66,
      },
      sandbox: this.config?.sandbox ?? {
        defaultMode: 'direct',
        useWorktrees: true,
      },
      fileAccess: this.config?.fileAccess ?? {
        denyList: ['.env', '.ssh/', 'credentials*'],
      },
    };
  }

  async syncCredentials(
    values: Partial<Record<Exclude<ProviderId, 'mock'>, string>>,
  ): Promise<ProviderCredentialStatus[]> {
    const syncedAt = Date.now();
    for (const provider of ['openai', 'anthropic'] as const) {
      const value = values[provider];
      if (typeof value === 'string' && value.trim()) {
        this.credentials.set(provider, value.trim());
      } else if (value === '') {
        this.credentials.delete(provider);
      }
    }

    this.rebuildAgents();
    const credentials = this.getCredentialStatuses(syncedAt);
    this.notify({
      method: 'v1.credentials.updated',
      params: { credentials },
    });
    return credentials;
  }

  async startSession(): Promise<ProjectSnapshot> {
    if (!this.config || !this.projectRoot) {
      await this.loadProject();
    }

    const now = Date.now();
    this.session = this.session
      ? {
          ...this.session,
          updatedAt: now,
          status: 'idle',
        }
      : {
          id: randomUUID(),
          projectRoot: this.projectRoot!,
          projectName: this.config!.team.name,
          createdAt: now,
          updatedAt: now,
          status: 'idle',
        };

    await this.database?.saveSession(this.session);
    this.notify({
      method: 'v1.session.updated',
      params: { session: this.session },
    });
    return this.getSnapshot();
  }

  async createTask(
    title: string,
    description: string,
    parentTaskId?: string,
  ): Promise<ProjectSnapshot> {
    if (!this.session) {
      await this.startSession();
    }

    const task = this.taskManager.create(title, description, {
      parentTaskId,
      assignedAgents: this.config?.team.agents.map((agent) => agent.id) ?? [],
      sessionId: this.session?.id,
      consensusState: 'pending',
    });

    await this.database?.saveTask(task);
    this.notify({
      method: 'v1.task.updated',
      params: { task },
    });

    void this.runTask(task.id);
    return this.getSnapshot();
  }

  async listTasks(): Promise<Task[]> {
    return this.taskManager.list();
  }

  async listMessages(taskId?: string): Promise<AgentMessage[]> {
    return this.messageBus.getHistory(taskId);
  }

  async resolveConsensus(
    taskId: string,
    action: 'continue' | 'override' | 'approve_majority',
    overrideMessage?: string,
  ): Promise<ProjectSnapshot> {
    const task = this.taskManager.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (action === 'override') {
      const message: AgentMessage = {
        id: randomUUID(),
        agentId: 'user',
        agentRole: 'User',
        type: 'user',
        content: overrideMessage?.trim() || 'User approved a manual override.',
        timestamp: Date.now(),
        taskId,
        tokenEstimate: estimateTokens(overrideMessage ?? ''),
      };
      this.messageBus.emit(message);
      this.taskManager.transition(taskId, 'completed');
      this.taskManager.setConsensusState(taskId, 'reached');
      await this.database?.saveTask(this.taskManager.get(taskId)!);
      return this.getSnapshot();
    }

    this.taskManager.update(taskId, {
      status: 'in_progress',
      consensusState: 'pending',
    });
    await this.database?.saveTask(this.taskManager.get(taskId)!);
    void this.runTask(taskId, action === 'continue' ? overrideMessage : undefined);
    return this.getSnapshot();
  }

  private async runTask(taskId: string, userGuidance?: string): Promise<void> {
    const task = this.taskManager.get(taskId);
    if (!task || !this.config) {
      return;
    }

    if (task.status === 'pending') {
      this.taskManager.transition(taskId, 'in_progress');
    } else {
      this.taskManager.update(taskId, { status: 'in_progress' });
    }

    const sandboxPath = await this.prepareSandbox(taskId);
    if (sandboxPath) {
      const diffStat = await this.getSandboxDiffStat(sandboxPath);
      this.taskManager.setSandbox(taskId, sandboxPath, diffStat);
    }

    await this.database?.saveTask(this.taskManager.get(taskId)!);
    this.notify({
      method: 'v1.task.updated',
      params: { task: this.taskManager.get(taskId)! },
    });

    const consensus = new ConsensusProtocol(this.config.consensus);
    const agentIds = this.config.team.agents.map((agent) => agent.id);
    let prompt = buildRoundPrompt(this.config.team.agents, task, userGuidance);

    for (let round = 1; round <= this.config.consensus.maxRounds; round++) {
      for (const agent of this.config.team.agents) {
        this.setAgentStatus(agent.id, 'thinking');
      }

      for await (const message of this.orchestrator.runRound(taskId, prompt, round)) {
        this.setAgentStatus(message.agentId, 'writing');
        consensus.recordPosition(message.agentId, message.content);
        const tokenEstimate =
          (this.taskManager.get(taskId)?.tokenEstimate ?? 0) +
          (message.tokenEstimate ?? 0);
        this.taskManager.updateTokenEstimate(taskId, tokenEstimate);
        await this.database?.saveTask(this.taskManager.get(taskId)!);
        this.setAgentStatus(message.agentId, 'waiting_for_consensus');
      }

      const result = consensus.evaluate(agentIds);
      const state: ConsensusState = {
        taskId,
        round,
        status: result.status === 'reached' ? 'reached' : 'pending',
        supporters: result.status === 'reached' ? result.supporters : [],
        summary: consensus.getEscalationSummary(),
        updatedAt: Date.now(),
      };
      this.consensusStates.set(taskId, state);
      await this.database?.saveConsensus(state);
      this.notify({
        method: 'v1.consensus.updated',
        params: { consensus: state },
      });

      if (result.status === 'reached') {
        this.taskManager.setConsensusState(taskId, 'reached');
        this.taskManager.transition(taskId, 'completed');
        await this.database?.saveTask(this.taskManager.get(taskId)!);
        this.resetAgentStatuses();
        this.notify({
          method: 'v1.task.updated',
          params: { task: this.taskManager.get(taskId)! },
        });
        this.notify({
          method: 'v1.shell.notification',
          params: {
            level: 'info',
            title: 'Task completed',
            body: task.title,
          },
        });
        return;
      }

      if (round >= this.config.consensus.maxRounds) {
        const escalated: ConsensusState = {
          ...state,
          status: 'escalated',
          updatedAt: Date.now(),
        };
        this.consensusStates.set(taskId, escalated);
        this.taskManager.setConsensusState(taskId, 'escalated');
        this.taskManager.transition(taskId, 'review');
        if (this.session) {
          this.session = {
            ...this.session,
            status: 'awaiting_user',
            updatedAt: Date.now(),
          };
          await this.database?.saveSession(this.session);
        }
        await this.database?.saveConsensus(escalated);
        await this.database?.saveTask(this.taskManager.get(taskId)!);
        this.resetAgentStatuses();
        this.notify({
          method: 'v1.consensus.updated',
          params: { consensus: escalated },
        });
        this.notify({
          method: 'v1.shell.notification',
          params: {
            level: 'warning',
            title: 'Consensus required',
            body: task.title,
          },
        });
        return;
      }

      prompt = buildFollowUpPrompt(task, round + 1, consensus.getEscalationSummary());
    }
  }

  private rebuildAgents(): void {
    this.orchestrator.getAgents().forEach((agent) => {
      this.orchestrator.removeAgent(agent.id);
    });
    this.agentStatuses.clear();

    for (const agentConfig of this.config?.team.agents ?? []) {
      const { agent, hasCredentials, lastError } = createAgent(
        agentConfig,
        this.credentials,
      );
      this.orchestrator.addAgent(agent);
      this.agentStatuses.set(agentConfig.id, {
        agentId: agentConfig.id,
        role: agentConfig.role,
        model: agentConfig.model,
        provider: agentConfig.provider,
        status: hasCredentials || agentConfig.provider === 'mock' ? 'idle' : 'unavailable',
        hasCredentials,
        lastError,
      });
    }
  }

  private setAgentStatus(agentId: string, status: AgentStatus['status']): void {
    const current = this.agentStatuses.get(agentId);
    if (!current) {
      return;
    }

    const next = { ...current, status };
    this.agentStatuses.set(agentId, next);
    this.notify({
      method: 'v1.agent.updated',
      params: { agent: next },
    });
  }

  private resetAgentStatuses(): void {
    for (const [agentId, status] of this.agentStatuses) {
      this.agentStatuses.set(agentId, {
        ...status,
        status:
          status.hasCredentials || status.provider === 'mock'
            ? 'idle'
            : 'unavailable',
      });
    }
  }

  private async refreshTemplates(): Promise<TemplateSummary[]> {
    await mkdir(this.templatesDir, { recursive: true });
    const entries = await readdir(this.templatesDir, { withFileTypes: true });
    const templates: TemplateSummary[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }

      const id = entry.name.replace(/\.json$/, '');
      const raw = await readFile(join(this.templatesDir, entry.name), 'utf8');
      const template = JSON.parse(raw) as {
        name: string;
        description?: string;
        agents: AgentConfig[];
      };
      templates.push({
        id,
        name: template.name,
        description: template.description ?? `Built-in template: ${template.name}`,
        path: join(this.templatesDir, entry.name),
        providers: [...new Set(template.agents.map((agent) => agent.provider))],
      });
    }

    return templates.sort((left, right) => left.name.localeCompare(right.name));
  }

  private getCredentialStatuses(syncedAt?: number): ProviderCredentialStatus[] {
    return (['openai', 'anthropic'] as const).map((provider) => ({
      provider,
      hasKey: this.credentials.has(provider),
      syncedAt: this.credentials.has(provider) ? syncedAt ?? Date.now() : undefined,
    }));
  }

  private async prepareSandbox(taskId: string): Promise<string | undefined> {
    if (
      !this.config ||
      !this.projectRoot ||
      this.config.sandbox.defaultMode !== 'worktree' ||
      !this.config.sandbox.useWorktrees
    ) {
      return undefined;
    }

    const worktreeRoot = resolve(this.projectRoot, '.worktrees', taskId);
    await mkdir(resolve(this.projectRoot, '.worktrees'), { recursive: true });
    await runGitCommand(this.projectRoot, [
      'worktree',
      'add',
      '--force',
      '--detach',
      worktreeRoot,
      'HEAD',
    ]).catch((error) => {
      this.lastError =
        error instanceof Error ? error.message : 'Failed to prepare worktree';
    });

    return worktreeRoot;
  }

  private async getSandboxDiffStat(worktreePath: string): Promise<string | undefined> {
    return runGitCommand(worktreePath, ['diff', '--stat']).catch(() => undefined);
  }

  private startProjectWatcher(projectRoot: string): void {
    this.projectWatcher?.close();
    if (!['win32', 'darwin'].includes(process.platform)) {
      this.projectWatcher = undefined;
      return;
    }

    try {
      this.projectWatcher = watch(
        projectRoot,
        { recursive: true },
        (eventType: string, filename: string | Buffer | null) => {
          const relativePath =
            typeof filename === 'string'
              ? filename
              : filename
                ? filename.toString()
                : null;

          if (!relativePath || relativePath.startsWith('.localteam')) {
            return;
          }

          this.notify({
            method: 'v1.project.external_change',
            params: {
              eventType,
              relativePath,
            },
          });
        },
      );
    } catch {
      this.projectWatcher = undefined;
    }
  }

  private async getSnapshot(): Promise<ProjectSnapshot> {
    return {
      version: 'v1',
      projectRoot: this.projectRoot,
      config: this.config,
      session: this.session,
      tasks: this.taskManager.list(),
      messages: this.messageBus.getHistory(),
      consensus: Array.from(this.consensusStates.values()).sort(
        (left, right) => left.updatedAt - right.updatedAt,
      ),
      agentStatuses: Array.from(this.agentStatuses.values()),
      credentials: this.getCredentialStatuses(),
      templates: await this.refreshTemplates(),
      sidecar: {
        ready: true,
        version: DEFAULT_VERSION,
        uptime: Date.now() - this.startedAt,
        lastError: this.lastError,
      },
    };
  }
}

function buildRoundPrompt(
  agents: AgentConfig[],
  task: Task,
  userGuidance?: string,
): string {
  const roster = agents
    .map((agent) => `- ${agent.role} (${agent.id})`)
    .join('\n');

  return [
    'You are collaborating with the rest of the LocalTeam panel.',
    `Task: ${task.title}`,
    `Description: ${task.description}`,
    userGuidance ? `Additional user guidance: ${userGuidance}` : null,
    'Respond with one short position. Start with AGREE, OBJECTION, or PROPOSAL.',
    'Reference the tradeoff you care about most. Keep it under 120 words.',
    `Team roster:\n${roster}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function buildFollowUpPrompt(
  task: Task,
  nextRound: number,
  positions: ConsensusState['summary'],
): string {
  const summary = positions
    .map((position) => `${position.agentId}: ${position.position}`)
    .join('\n');

  return [
    `Round ${nextRound} for task "${task.title}".`,
    'The previous positions were:',
    summary,
    'Respond again. Start with AGREE if you can align, otherwise start with OBJECTION or PROPOSAL.',
  ].join('\n\n');
}

function estimateTokens(content: string): number {
  return Math.max(1, Math.ceil(content.length / 4));
}

async function runGitCommand(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('git', args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', rejectPromise);
    child.on('close', (code: number | null) => {
      if (code === 0) {
        resolvePromise(stdout.trim());
      } else {
        rejectPromise(new Error(stderr.trim() || `git ${args.join(' ')} failed`));
      }
    });
  });
}

async function resolveProjectRoot(rootPath: string): Promise<string> {
  const candidates = [resolve(rootPath), resolve(rootPath, '..')];
  for (const candidate of candidates) {
    try {
      await readFile(join(candidate, DEFAULT_PROJECT_FILE), 'utf8');
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error(
    `Project config not found. Checked ${candidates
      .map((candidate) => join(candidate, DEFAULT_PROJECT_FILE))
      .join(', ')}`,
  );
}
