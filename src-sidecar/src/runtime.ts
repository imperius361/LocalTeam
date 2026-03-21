import { randomUUID } from 'node:crypto';
import { existsSync, statSync, watch } from 'node:fs';
import { copyFile, mkdir, readFile, readdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { assignAgentsByRole } from './assignment.js';
import { evaluateCommandPolicy } from './command-safety.js';
import { ConsensusProtocol } from './consensus.js';
import {
  buildDecompositionPrompt,
  deriveSubtasksFromLeadOutput,
  selectLeadAgent,
} from './decomposition.js';
import { MessageBus } from './message-bus.js';
import { Orchestrator } from './orchestrator.js';
import type { MessageErrorEvent } from './orchestrator.js';
import {
  ProjectDatabase,
  readWorkspaceConfig,
  resolveWorkspaceDatabasePath,
  resolveWorkspaceStorageRoot,
  writeWorkspaceConfig,
} from './persistence.js';
import type { IpcNotification } from './protocol.js';
import { createAgent } from './providers/factory.js';
import { TaskManager } from './task-manager.js';
import {
  parseProjectConfig,
  validateProjectConfig,
} from './team-config.js';
import { canonicalizeWorkspacePath } from './workspace-path.js';
import type {
  AgentConfig,
  CommandApproval,
  CommandExecutionRequest,
  AgentMessage,
  AgentStatus,
  ConsensusState,
  MessageStreamFinalization,
  MessageStreamDelta,
  ProjectConfig,
  ProjectSnapshot,
  ProviderCredentialStatus,
  ProviderId,
  SessionState,
  Task,
  TemplateSummary,
} from './types.js';

const DEFAULT_TEMPLATE_FILE = 'default-team.json';
const DEFAULT_VERSION = '0.2.0';
const DEFAULT_CONSENSUS = {
  maxRounds: 3,
  requiredMajority: 0.66,
} satisfies ProjectConfig['consensus'];
const DEFAULT_SANDBOX = {
  defaultMode: 'direct',
  useWorktrees: true,
} satisfies ProjectConfig['sandbox'];
const DEFAULT_FILE_ACCESS = {
  denyList: ['.env', '.ssh/', 'credentials*'],
} satisfies ProjectConfig['fileAccess'];
const FALLBACK_DEFAULT_TEAM = {
  name: 'Default LocalTeam',
  agents: [
    {
      id: 'architect',
      role: 'Software Architect',
      model: 'gpt-4.1-mini',
      provider: 'openai',
      systemPrompt:
        'You are the lead architect. Drive the plan, decompose work, and keep the team aligned on scope and tradeoffs.',
      tools: ['read_file', 'search_code', 'propose_task'],
      allowedPaths: ['src/', 'src-sidecar/', 'src-tauri/', 'docs/'],
      canExecuteCommands: false,
    },
    {
      id: 'implementer',
      role: 'Implementation Engineer',
      model: 'gpt-4.1-mini',
      provider: 'openai',
      systemPrompt:
        'You implement the agreed change set, call out risks early, and keep the code path practical.',
      tools: ['read_file', 'search_code', 'artifact'],
      allowedPaths: ['src/', 'src-sidecar/', 'src-tauri/'],
      canExecuteCommands: false,
    },
    {
      id: 'security',
      role: 'Security Engineer',
      model: 'gpt-4.1-mini',
      provider: 'openai',
      systemPrompt:
        'You review for auth, secrets, sandboxing, unsafe execution, and least-privilege defaults.',
      tools: ['read_file', 'search_code', 'objection'],
      allowedPaths: ['src/', 'src-sidecar/', 'src-tauri/', 'docs/'],
      canExecuteCommands: false,
    },
  ],
} satisfies { name: string; agents: AgentConfig[] };

export class LocalTeamRuntime {
  private readonly startedAt = Date.now();
  private readonly messageBus = new MessageBus();
  private readonly orchestrator = new Orchestrator(this.messageBus);
  private readonly taskManager = new TaskManager();
  private readonly credentials = new Map<ProviderId, string>();
  private readonly agentStatuses = new Map<string, AgentStatus>();
  private readonly consensusStates = new Map<string, ConsensusState>();
  private readonly commandApprovals = new Map<string, CommandApproval>();
  private readonly taskGuidanceQueue = new Map<string, string[]>();
  private readonly activeTaskRuns = new Set<string>();
  private readonly defaultProjectRoot = resolveDefaultProjectRoot();
  private readonly templatesDir = resolveTemplatesDirectory(this.defaultProjectRoot);

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

  dispose(): void {
    this.clearLoadedProject();
  }

  private clearLoadedProject(): void {
    this.projectWatcher?.close();
    this.projectWatcher = undefined;
    this.projectRoot = null;
    this.config = null;
    this.session = null;
    this.database = null;
    this.consensusStates.clear();
    this.commandApprovals.clear();
    this.taskGuidanceQueue.clear();
    this.activeTaskRuns.clear();
    this.taskManager.hydrate([]);
    this.messageBus.hydrate([]);
    this.agentStatuses.clear();
    this.lastError = undefined;
  }

  private async ensureProjectLoaded(): Promise<void> {
    if (!this.config || !this.projectRoot) {
      await this.loadProject();
    }

    if (!this.config || !this.projectRoot) {
      throw new Error('No git workspace selected');
    }
  }

  private normalizeSelectedRoot(rootPath?: string | null): string | null {
    if (typeof rootPath !== 'string') {
      return null;
    }

    const trimmed = rootPath.trim();
    return trimmed ? canonicalizeWorkspacePath(trimmed) : null;
  }

  async loadProject(rootPath?: string): Promise<ProjectSnapshot> {
    const selectedRoot = this.normalizeSelectedRoot(rootPath ?? this.defaultProjectRoot);
    if (!selectedRoot) {
      this.clearLoadedProject();
      return this.getSnapshot();
    }

    const projectRoot = await resolveGitWorkspaceRoot(selectedRoot);
    if (!projectRoot) {
      throw new Error(`Selected folder is not a git workspace: ${selectedRoot}`);
    }

    const config = await this.loadWorkspaceConfig(projectRoot);
    await this.migrateLegacyWorkspaceState(projectRoot);

    const database = await ProjectDatabase.open(projectRoot);
    const state = await database.loadState();

    this.projectWatcher?.close();
    this.projectWatcher = undefined;
    this.taskGuidanceQueue.clear();
    this.activeTaskRuns.clear();
    this.lastError = undefined;

    this.projectRoot = projectRoot;
    this.config = config;
    this.database = database;
    this.messageBus.hydrate(state.messages);
    this.taskManager.hydrate(state.tasks);
    this.consensusStates.clear();
    state.consensus.forEach((entry) => {
      this.consensusStates.set(entry.taskId, entry);
    });
    this.commandApprovals.clear();
    state.commandApprovals.forEach((approval) => {
      this.commandApprovals.set(approval.id, approval);
    });
    this.session = state.session;

    this.rebuildAgents();
    this.startProjectWatcher(projectRoot);
    return this.getSnapshot();
  }

  async saveProject(config: ProjectConfig): Promise<ProjectSnapshot> {
    const errors = validateProjectConfig(config);
    if (errors.length > 0) {
      throw new Error(`Invalid workspace config: ${errors.join('; ')}`);
    }

    const projectRoot = this.projectRoot;
    if (!projectRoot) {
      throw new Error('No git workspace selected');
    }

    const resolvedRoot = await resolveGitWorkspaceRoot(projectRoot);
    if (!resolvedRoot) {
      throw new Error(`Selected folder is not a git workspace: ${projectRoot}`);
    }

    await writeWorkspaceConfig(resolvedRoot, config);
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

  private async createDefaultProjectConfig(): Promise<ProjectConfig> {
    const template = await readTemplateFile(join(this.templatesDir, DEFAULT_TEMPLATE_FILE));
    if (template) {
      return createProjectConfigFromTemplate(template);
    }

    return createProjectConfigFromTemplate(FALLBACK_DEFAULT_TEAM);
  }

  private async loadWorkspaceConfig(projectRoot: string): Promise<ProjectConfig> {
    const storedConfig = await readWorkspaceConfig(projectRoot);
    if (storedConfig) {
      const errors = validateProjectConfig(storedConfig);
      if (errors.length > 0) {
        throw new Error(`Invalid workspace config: ${errors.join('; ')}`);
      }
      return storedConfig;
    }

    const importedConfig = await this.importLegacyWorkspaceConfig(projectRoot);
    if (importedConfig) {
      return importedConfig;
    }

    const config = await this.createDefaultProjectConfig();
    await writeWorkspaceConfig(projectRoot, config);
    return config;
  }

  private async importLegacyWorkspaceConfig(projectRoot: string): Promise<ProjectConfig | null> {
    const legacyConfigPath = join(projectRoot, 'localteam.json');
    try {
      const raw = await readFile(legacyConfigPath, 'utf8');
      const config = parseProjectConfig(raw);
      const errors = validateProjectConfig(config);
      if (errors.length > 0) {
        throw new Error(`Invalid localteam.json: ${errors.join('; ')}`);
      }

      await writeWorkspaceConfig(projectRoot, config);
      return config;
    } catch (error) {
      if (isMissingFileError(error)) {
        return null;
      }
      throw error;
    }
  }

  private async migrateLegacyWorkspaceState(projectRoot: string): Promise<void> {
    const legacyDatabasePath = join(projectRoot, '.localteam', 'localteam.db');
    const workspaceDatabasePath = resolveWorkspaceDatabasePath(projectRoot);
    if (!existsSync(legacyDatabasePath) || existsSync(workspaceDatabasePath)) {
      return;
    }

    await mkdir(resolveWorkspaceStorageRoot(projectRoot), { recursive: true });
    await copyFile(legacyDatabasePath, workspaceDatabasePath);
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

    if (!this.config || !this.projectRoot) {
      return this.getSnapshot();
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
    await this.ensureProjectLoaded();

    if (!this.session) {
      await this.startSession();
    }

    const assignedAgents = this.selectAgentsForTask(
      title,
      description,
      parentTaskId ? 1 : 2,
    );

    const task = this.taskManager.create(title, description, {
      parentTaskId,
      assignedAgents,
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

  async interjectTask(taskId: string, guidance: string): Promise<ProjectSnapshot> {
    await this.ensureProjectLoaded();

    const task = this.taskManager.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const trimmedGuidance = guidance.trim();
    if (!trimmedGuidance) {
      throw new Error('Guidance must not be empty');
    }

    const message: AgentMessage = {
      id: randomUUID(),
      agentId: 'user',
      agentRole: 'User',
      type: 'user',
      content: trimmedGuidance,
      timestamp: Date.now(),
      taskId,
      tokenEstimate: estimateTokens(trimmedGuidance),
    };

    this.messageBus.emit(message);
    this.queueTaskGuidance(taskId, trimmedGuidance);
    this.notify({
      method: 'v1.task.interjected',
      params: {
        taskId,
        guidance: trimmedGuidance,
        running: this.activeTaskRuns.has(taskId),
      },
    });

    this.notifyShellNotification('info', 'Task guidance received', task.title);

    if (!this.activeTaskRuns.has(taskId)) {
      this.taskManager.update(taskId, {
        status: 'in_progress',
        consensusState: 'pending',
      });
      const updatedTask = this.taskManager.get(taskId)!;
      await this.database?.saveTask(updatedTask);
      this.notify({
        method: 'v1.task.updated',
        params: { task: updatedTask },
      });
      void this.runTask(taskId);
    }

    return this.getSnapshot();
  }

  async listTasks(): Promise<Task[]> {
    return this.taskManager.list();
  }

  async listMessages(taskId?: string): Promise<AgentMessage[]> {
    return this.messageBus.getHistory(taskId);
  }

  async listCommandApprovals(taskId?: string): Promise<CommandApproval[]> {
    const approvals = Array.from(this.commandApprovals.values()).sort(
      (left, right) => left.requestedAt - right.requestedAt,
    );
    if (!taskId) {
      return approvals;
    }
    return approvals.filter((approval) => approval.taskId === taskId);
  }

  async requestCommandExecution(
    request: CommandExecutionRequest,
  ): Promise<CommandApproval> {
    await this.ensureProjectLoaded();

    const task = this.taskManager.get(request.taskId);
    if (!task) {
      throw new Error(`Task not found: ${request.taskId}`);
    }
    const projectRoot = this.projectRoot;
    const config = this.config;
    if (!projectRoot || !config) {
      throw new Error('No git workspace selected');
    }

    const agent = config.team.agents.find((entry) => entry.id === request.agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${request.agentId}`);
    }

    const policy = evaluateCommandPolicy({
      projectRoot,
      config,
      task,
      agent,
      request,
    });

    const now = Date.now();
    const approval: CommandApproval = {
      id: randomUUID(),
      taskId: request.taskId,
      agentId: request.agentId,
      agentRole: agent.role,
      command: request.command,
      requestedCwd: request.cwd,
      effectiveCwd: policy.effectiveCwd,
      status: policy.allowed
        ? policy.requiresApproval
          ? 'pending'
          : 'approved'
        : 'denied',
      requiresApproval: policy.requiresApproval,
      preApproved: policy.preApproved,
      reason: policy.reason,
      requestedAt: now,
      updatedAt: now,
      decidedAt: policy.allowed ? undefined : now,
      policy: {
        sandboxMode: policy.sandboxMode,
        checkedPaths: policy.checkedPaths,
        allowedPaths: policy.allowedPaths,
        matchedDenyRule: policy.matchedDenyRule,
      },
    };

    this.commandApprovals.set(approval.id, approval);
    await this.database?.saveCommandApproval(approval);
    this.notify({
      method: 'v1.command.approval.updated',
      params: { approval },
    });

    if (!policy.allowed) {
      return approval;
    }

    if (policy.requiresApproval) {
      this.notify({
        method: 'v1.command.approval.required',
        params: { approval },
      });
      return approval;
    }

    return this.executeApprovedCommand(approval.id);
  }

  async resolveCommandApproval(
    approvalId: string,
    action: 'approve' | 'deny',
  ): Promise<CommandApproval> {
    const existing = this.commandApprovals.get(approvalId);
    if (!existing) {
      throw new Error(`Command approval not found: ${approvalId}`);
    }
    if (existing.status !== 'pending') {
      return existing;
    }

    const now = Date.now();
    const updated: CommandApproval = {
      ...existing,
      status: action === 'approve' ? 'approved' : 'denied',
      decidedAt: now,
      updatedAt: now,
      reason:
        action === 'deny'
          ? existing.reason ?? 'User denied command execution.'
          : existing.reason,
    };
    this.commandApprovals.set(updated.id, updated);
    await this.database?.saveCommandApproval(updated);
    this.notify({
      method: 'v1.command.approval.updated',
      params: { approval: updated },
    });

    if (action === 'deny') {
      return updated;
    }

    return this.executeApprovedCommand(updated.id);
  }

  async resolveConsensus(
    taskId: string,
    action: 'continue' | 'override' | 'approve_majority',
    overrideMessage?: string,
  ): Promise<ProjectSnapshot> {
    await this.ensureProjectLoaded();

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
    if (this.activeTaskRuns.has(taskId)) {
      if (typeof userGuidance === 'string' && userGuidance.trim()) {
        this.queueTaskGuidance(taskId, userGuidance.trim());
      }
      return;
    }

    this.activeTaskRuns.add(taskId);
    let streamFailureReported = false;
    const reportStreamFailure = async (
      task: Task,
      stage: string,
      event: MessageErrorEvent,
    ): Promise<void> => {
      streamFailureReported = true;
      const errorDetail = this.formatError(event.error);
      this.recordAgentError(event.agentId, errorDetail);
      this.lastError = errorDetail;
      this.emitSystemMessage(
        task.id,
        `LocalTeam could not continue ${stage} because ${event.agentRole} failed to respond: ${errorDetail}`,
        {
          id: event.messageId,
          round: event.round,
          timestamp: event.timestamp,
          meta: {
            stage,
            failedAgentId: event.agentId,
            failedAgentRole: event.agentRole,
            error: errorDetail,
          },
        },
      );
      this.notifyMessageFinalization({
        messageId: event.messageId,
        taskId: event.taskId,
        agentId: event.agentId,
        round: event.round,
        timestamp: Date.now(),
      });
    };

    try {
      const task = this.taskManager.get(taskId);
      if (!task || !this.config) {
        return;
      }

      let pendingGuidance = this.consumeTaskGuidance(taskId, userGuidance);

      if (task.status === 'pending') {
        this.taskManager.transition(taskId, 'in_progress');
      } else {
        this.taskManager.update(taskId, { status: 'in_progress' });
      }

      const sandboxPath = await this.prepareSandbox(taskId);
      if (sandboxPath) {
        const diffStat = await this.getSandboxDiffStat(sandboxPath);
        this.taskManager.setSandbox(taskId, sandboxPath, diffStat);
      } else if (this.config.sandbox.defaultMode === 'worktree') {
        this.taskManager.setSandbox(taskId, undefined, undefined);
      }

      await this.database?.saveTask(this.taskManager.get(taskId)!);
      this.notify({
        method: 'v1.task.updated',
        params: { task: this.taskManager.get(taskId)! },
      });
      await this.updateSessionStatus('running');

      await this.maybeDecomposeRootTask(
        taskId,
        async (rootTask, stage, event) => reportStreamFailure(rootTask, stage, event),
      );

      const activeTask = this.taskManager.get(taskId);
      if (!activeTask) {
        return;
      }

      const participantAgentIds = this.resolveParticipatingAgents(activeTask);
      if (participantAgentIds.length === 0) {
        this.taskManager.transition(taskId, 'review');
        await this.database?.saveTask(this.taskManager.get(taskId)!);
        this.notify({
          method: 'v1.task.updated',
          params: { task: this.taskManager.get(taskId)! },
        });
        this.emitSystemMessage(
          taskId,
          `LocalTeam could not start this discussion because no eligible agents were available for "${activeTask.title}".`,
          {
            meta: {
              reason: 'no_eligible_agents',
            },
          },
        );
        this.resetAgentStatuses();
        await this.refreshSessionStatus();
        this.notifyShellNotification(
          'warning',
          'No eligible agents',
          activeTask.title,
        );
        return;
      }

      const participantAgents = this.config.team.agents.filter((agent) =>
        participantAgentIds.includes(agent.id),
      );

      if (
        activeTask.assignedAgents.length !== participantAgentIds.length ||
        activeTask.assignedAgents.some((id) => !participantAgentIds.includes(id))
      ) {
        this.taskManager.assign(taskId, participantAgentIds);
        await this.database?.saveTask(this.taskManager.get(taskId)!);
        this.notify({
          method: 'v1.task.updated',
          params: { task: this.taskManager.get(taskId)! },
        });
      }

      const consensus = new ConsensusProtocol(this.config.consensus);
      let prompt = buildRoundPrompt(participantAgents, activeTask, pendingGuidance);

      for (let round = 1; round <= this.config.consensus.maxRounds; round++) {
        for (const agentId of participantAgentIds) {
          this.setAgentStatus(agentId, 'thinking');
        }

        for await (const message of this.orchestrator.runRound(taskId, prompt, round, {
          agentIds: participantAgentIds,
          onStreamDelta: async (event) => this.notifyStreamDelta(event),
          onMessageFinalized: async ({ message }) =>
            this.notifyMessageFinalization({
              messageId: message.id,
              taskId: message.taskId ?? taskId,
              agentId: message.agentId,
              round: message.round ?? round,
              timestamp: Date.now(),
            }),
          onMessageError: async (event) =>
            reportStreamFailure(activeTask, `round ${round}`, event),
        })) {
          this.setAgentStatus(message.agentId, 'writing');
          consensus.recordPosition(message.agentId, message.content);
          const tokenEstimate =
            (this.taskManager.get(taskId)?.tokenEstimate ?? 0) +
            (message.tokenEstimate ?? 0);
          this.taskManager.updateTokenEstimate(taskId, tokenEstimate);
          await this.database?.saveTask(this.taskManager.get(taskId)!);
          this.setAgentStatus(message.agentId, 'waiting_for_consensus');
        }

        const result = consensus.evaluate(participantAgentIds);
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
          await this.refreshSessionStatus();
          this.notify({
            method: 'v1.task.updated',
            params: { task: this.taskManager.get(taskId)! },
          });
          this.notifyShellNotification('info', 'Task completed', activeTask.title);
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
          await this.database?.saveConsensus(escalated);
          await this.database?.saveTask(this.taskManager.get(taskId)!);
          this.resetAgentStatuses();
          await this.refreshSessionStatus();
          this.notify({
            method: 'v1.consensus.updated',
            params: { consensus: escalated },
          });
          this.notifyShellNotification('warning', 'Consensus required', activeTask.title);
          return;
        }

        const nextGuidance = this.consumeTaskGuidance(taskId);
        const followUpPrompt = buildFollowUpPrompt(
          activeTask,
          round + 1,
          consensus.getEscalationSummary(),
        );
        prompt = nextGuidance
          ? [nextGuidance, followUpPrompt].join('\n\n')
          : followUpPrompt;
      }
    } catch (error) {
      await this.handleTaskRunFailure(taskId, error, streamFailureReported);
    } finally {
      this.activeTaskRuns.delete(taskId);
      const followUpGuidance = this.consumeTaskGuidance(taskId);
      if (followUpGuidance) {
        void this.runTask(taskId, followUpGuidance);
      }
    }
  }

  private async maybeDecomposeRootTask(
    taskId: string,
    onMessageError?: (
      task: Task,
      stage: string,
      event: MessageErrorEvent,
    ) => Promise<void> | void,
  ): Promise<void> {
    if (!this.config) {
      return;
    }

    const task = this.taskManager.get(taskId);
    if (!task || task.parentTaskId) {
      return;
    }

    const existingSubtasks = this.taskManager
      .list()
      .filter((entry) => entry.parentTaskId === taskId);
    if (existingSubtasks.length > 0) {
      return;
    }

    const lead = selectLeadAgent(this.config.team.agents);
    if (!lead) {
      return;
    }

    const prompt = buildDecompositionPrompt(task, this.config.team.agents);
    let leadMessage: AgentMessage | undefined;
    this.setAgentStatus(lead.id, 'thinking');
    for await (const message of this.orchestrator.runRound(taskId, prompt, 0, {
      agentIds: [lead.id],
      onStreamDelta: async (event) => this.notifyStreamDelta(event),
      onMessageFinalized: async ({ message }) =>
        this.notifyMessageFinalization({
          messageId: message.id,
          taskId: message.taskId ?? taskId,
          agentId: message.agentId,
          round: message.round ?? 0,
          timestamp: Date.now(),
        }),
      onMessageError: onMessageError
        ? async (event) => onMessageError(task, 'task decomposition', event)
        : undefined,
    })) {
      this.setAgentStatus(message.agentId, 'writing');
      leadMessage = message;
      const tokenEstimate =
        (this.taskManager.get(taskId)?.tokenEstimate ?? 0) +
        (message.tokenEstimate ?? 0);
      this.taskManager.updateTokenEstimate(taskId, tokenEstimate);
      await this.database?.saveTask(this.taskManager.get(taskId)!);
      this.setAgentStatus(message.agentId, 'idle');
    }

    const leadOutput = leadMessage?.content ?? '';
    const subtasks = deriveSubtasksFromLeadOutput(task, this.config.team.agents, leadOutput);

    for (const subtaskSpec of subtasks) {
      const subtask = this.taskManager.createSubtask(
        taskId,
        subtaskSpec.title,
        subtaskSpec.description,
      );
      const assignees = assignAgentsByRole(
        this.config.team.agents,
        subtask.title,
        subtask.description,
        {
          roleHint: subtaskSpec.roleHint,
          maxAgents: 1,
          fallbackAgentId: lead.id,
        },
      );
      this.taskManager.assign(subtask.id, assignees);
      this.taskManager.update(subtask.id, {
        sessionId: task.sessionId,
        consensusState: 'pending',
      });
      const persisted = this.taskManager.get(subtask.id)!;
      await this.database?.saveTask(persisted);
      this.notify({
        method: 'v1.task.updated',
        params: { task: persisted },
      });
    }
  }

  private resolveParticipatingAgents(task: Task): string[] {
    if (!this.config) {
      return [];
    }

    const available = new Set(this.config.team.agents.map((agent) => agent.id));
    const assigned = task.assignedAgents.filter((agentId) => available.has(agentId));
    if (assigned.length > 0) {
      return assigned;
    }

    const fallback = this.selectAgentsForTask(task.title, task.description, task.parentTaskId ? 1 : 2);
    return fallback.filter((agentId) => available.has(agentId));
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

    const next = {
      ...current,
      status,
      lastError: status === 'thinking' ? undefined : current.lastError,
    };
    this.agentStatuses.set(agentId, next);
    this.notify({
      method: 'v1.agent.updated',
      params: { agent: next },
    });
  }

  private resetAgentStatuses(): void {
    for (const [agentId, status] of this.agentStatuses) {
      const next: AgentStatus = {
        ...status,
        status:
          status.hasCredentials || status.provider === 'mock'
            ? 'idle'
            : 'unavailable',
      };
      this.agentStatuses.set(agentId, next);
      if (next.status !== status.status) {
        this.notify({
          method: 'v1.agent.updated',
          params: { agent: next },
        });
      }
    }
  }

  private recordAgentError(agentId: string, errorDetail: string): void {
    const current = this.agentStatuses.get(agentId);
    if (!current) {
      return;
    }

    const next = {
      ...current,
      lastError: errorDetail,
    };
    this.agentStatuses.set(agentId, next);
    this.notify({
      method: 'v1.agent.updated',
      params: { agent: next },
    });
  }

  private notifyStreamDelta(event: MessageStreamDelta): void {
    this.notify({
      method: 'v1.session.message.delta',
      params: { delta: event },
    });
  }

  private notifyMessageFinalization(event: MessageStreamFinalization): void {
    this.notify({
      method: 'v1.session.message.finalized',
      params: { finalization: event },
    });
  }

  private emitSystemMessage(
    taskId: string,
    content: string,
    options: {
      id?: string;
      round?: number;
      timestamp?: number;
      meta?: Record<string, unknown>;
    } = {},
  ): void {
    this.messageBus.emit({
      id: options.id ?? randomUUID(),
      agentId: 'system',
      agentRole: 'System',
      type: 'system',
      content,
      timestamp: options.timestamp ?? Date.now(),
      taskId,
      round: options.round,
      tokenEstimate: estimateTokens(content),
      meta: options.meta,
    });
  }

  private notifyShellNotification(
    level: 'info' | 'warning' | 'error',
    title: string,
    body: string,
  ): void {
    this.notify({
      method: 'v1.shell.notification',
      params: {
        level,
        title,
        body,
      },
    });
  }

  private async updateSessionStatus(status: SessionState['status']): Promise<void> {
    if (!this.session || this.session.status === status) {
      return;
    }

    this.session = {
      ...this.session,
      status,
      updatedAt: Date.now(),
    };
    await this.database?.saveSession(this.session);
    this.notify({
      method: 'v1.session.updated',
      params: { session: this.session },
    });
  }

  private async refreshSessionStatus(): Promise<void> {
    if (!this.session) {
      return;
    }

    const tasks = this.taskManager.list();
    const hasRunningTask = tasks.some((task) => task.status === 'in_progress');
    const hasReviewTask = tasks.some((task) => task.status === 'review');
    const nextStatus = hasRunningTask
      ? 'running'
      : hasReviewTask
        ? 'awaiting_user'
        : 'idle';
    await this.updateSessionStatus(nextStatus);
  }

  private formatError(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message.trim();
    }
    if (typeof error === 'string' && error.trim()) {
      return error.trim();
    }
    return 'Unknown runtime error';
  }

  private async handleTaskRunFailure(
    taskId: string,
    error: unknown,
    streamFailureReported: boolean,
  ): Promise<void> {
    const errorDetail = this.formatError(error);
    this.lastError = errorDetail;

    const task = this.taskManager.get(taskId);
    if (task) {
      if (task.status === 'in_progress') {
        this.taskManager.transition(taskId, 'review');
      } else {
        this.taskManager.update(taskId, { status: 'review' });
      }
      const updatedTask = this.taskManager.get(taskId)!;
      await this.database?.saveTask(updatedTask);
      this.notify({
        method: 'v1.task.updated',
        params: { task: updatedTask },
      });
      if (!streamFailureReported) {
        this.emitSystemMessage(
          taskId,
          `LocalTeam could not continue "${updatedTask.title}": ${errorDetail}`,
          {
            meta: {
              error: errorDetail,
            },
          },
        );
      }
    }

    this.resetAgentStatuses();
    await this.refreshSessionStatus();
    this.notifyShellNotification(
      'error',
      'Task moved to review',
      task ? `${task.title}: ${errorDetail}` : errorDetail,
    );
  }

  private selectAgentsForTask(
    title: string,
    description: string,
    maxAgents: number,
    roleHint?: string,
  ): string[] {
    if (!this.config) {
      return [];
    }

    const lead = selectLeadAgent(this.config.team.agents);
    return assignAgentsByRole(this.config.team.agents, title, description, {
      roleHint,
      maxAgents,
      fallbackAgentId: lead?.id,
    });
  }

  private async executeApprovedCommand(approvalId: string): Promise<CommandApproval> {
    const approval = this.commandApprovals.get(approvalId);
    if (!approval) {
      throw new Error(`Command approval not found: ${approvalId}`);
    }

    const commandResult = await runShellCommand(approval.command, approval.effectiveCwd);
    const now = Date.now();
    const status = commandResult.exitCode === 0 ? 'completed' : 'failed';
    const updated: CommandApproval = {
      ...approval,
      status,
      updatedAt: now,
      completedAt: now,
      exitCode: commandResult.exitCode,
      stdout: commandResult.stdout,
      stderr: commandResult.stderr,
      reason:
        commandResult.exitCode === 0
          ? approval.reason
          : approval.reason ?? 'Command failed with a non-zero exit code.',
    };

    this.commandApprovals.set(updated.id, updated);
    await this.database?.saveCommandApproval(updated);
    this.notify({
      method: 'v1.command.approval.updated',
      params: { approval: updated },
    });
    this.notify({
      method: 'v1.command.execution.completed',
      params: { approval: updated },
    });
    return updated;
  }

  private async refreshTemplates(): Promise<TemplateSummary[]> {
    let entries;
    try {
      entries = await readdir(this.templatesDir, { withFileTypes: true });
    } catch (error) {
      if (isMissingFileError(error)) {
        return [];
      }
      throw error;
    }

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

  private queueTaskGuidance(taskId: string, guidance: string): void {
    const queue = this.taskGuidanceQueue.get(taskId) ?? [];
    queue.push(guidance);
    this.taskGuidanceQueue.set(taskId, queue);
  }

  private consumeTaskGuidance(taskId: string, guidance?: string): string | undefined {
    const items: string[] = [];
    if (typeof guidance === 'string' && guidance.trim()) {
      items.push(guidance.trim());
    }

    const queued = this.taskGuidanceQueue.get(taskId);
    if (queued && queued.length > 0) {
      items.push(...queued);
      this.taskGuidanceQueue.delete(taskId);
    }

    return items.length > 0 ? items.join('\n\n') : undefined;
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

    const workspaceStorageRoot = resolveWorkspaceStorageRoot(this.projectRoot);
    const worktreeDirectory = resolve(workspaceStorageRoot, 'worktrees');
    const worktreeRoot = resolve(worktreeDirectory, taskId);
    await mkdir(worktreeDirectory, { recursive: true });

    try {
      await runGitCommand(this.projectRoot, [
        'worktree',
        'add',
        '--force',
        '--detach',
        worktreeRoot,
        'HEAD',
      ]);
      return worktreeRoot;
    } catch (error) {
      const errorDetail = this.formatError(error);
      this.lastError = errorDetail;
      const task = this.taskManager.get(taskId);
      if (task) {
        this.emitSystemMessage(
          taskId,
          `LocalTeam could not prepare a worktree for "${task.title}": ${errorDetail}`,
          {
            meta: {
              stage: 'sandbox',
              error: errorDetail,
            },
          },
        );
        this.notifyShellNotification(
          'warning',
          'Worktree setup failed',
          `${task.title}: ${errorDetail}`,
        );
      }
      return undefined;
    }
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
      const watcher = watch(
        projectRoot,
        { recursive: true },
        (eventType: string, filename: string | Buffer | null) => {
          const relativePath =
            typeof filename === 'string'
              ? filename
              : filename
                ? filename.toString()
                : null;

          if (!relativePath || shouldIgnoreExternalChange(relativePath)) {
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
      watcher.on('error', (error) => {
        try {
          watcher.close();
        } catch {
          // Ignore close failures while the watcher is already unwinding.
        }

        if (this.projectWatcher === watcher) {
          this.projectWatcher = undefined;
        }

        if (isWatcherTeardownError(error)) {
          return;
        }

        this.lastError = this.formatError(error);
      });
      this.projectWatcher = watcher;
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
      commandApprovals: Array.from(this.commandApprovals.values()).sort(
        (left, right) => left.requestedAt - right.requestedAt,
      ),
      sidecar: {
        ready: true,
        version: DEFAULT_VERSION,
        uptime: Date.now() - this.startedAt,
        lastError: this.lastError,
      },
    };
  }
}

export function shouldIgnoreExternalChange(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (!normalized) {
    return true;
  }

  return (
    normalized === '.localteam' ||
    normalized.startsWith('.localteam/') ||
    normalized === 'EBWebView' ||
    normalized.startsWith('EBWebView/') ||
    normalized === 'WebView2' ||
    normalized.startsWith('WebView2/') ||
    normalized === 'Crashpad' ||
    normalized.startsWith('Crashpad/')
  );
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

interface ShellCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runShellCommand(command: string, cwd: string): Promise<ShellCommandResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'powershell.exe' : '/bin/bash';
    const args = isWindows
      ? ['-NoLogo', '-NoProfile', '-Command', command]
      : ['-lc', command];

    const child = spawn(shell, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const maxOutputLength = 64_000;
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
    }, 60_000);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > maxOutputLength) {
        stdout = stdout.slice(0, maxOutputLength);
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > maxOutputLength) {
        stderr = stderr.slice(0, maxOutputLength);
      }
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    });

    child.on('close', (code: number | null) => {
      clearTimeout(timeout);
      resolvePromise({
        exitCode: code ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}

async function resolveGitWorkspaceRoot(rootPath: string): Promise<string | null> {
  return runGitCommand(resolve(rootPath), ['rev-parse', '--show-toplevel'])
    .then((value) => canonicalizeWorkspacePath(value))
    .catch(() => null);
}

function resolveDefaultProjectRoot(): string | null {
  const configured = process.env.LOCALTEAM_DEFAULT_PROJECT_ROOT?.trim();
  if (configured) {
    return canonicalizeWorkspacePath(configured);
  }
  return null;
}

function resolveTemplatesDirectory(defaultProjectRoot?: string | null): string {
  const configured = process.env.LOCALTEAM_TEMPLATES_DIR?.trim();
  if (configured) {
    return resolve(configured);
  }

  const cwd = resolve(process.cwd());
  const candidates = [
    resolve(cwd, 'templates'),
    resolve(cwd, '..', 'templates'),
    defaultProjectRoot ? resolve(defaultProjectRoot, 'templates') : null,
  ];

  for (const candidate of candidates) {
    if (candidate && directoryExists(candidate)) {
      return candidate;
    }
  }

  return basename(cwd) === 'src-sidecar'
    ? resolve(cwd, '..', 'templates')
    : resolve(cwd, 'templates');
}

function directoryExists(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isWatcherTeardownError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'EPERM' || error.code === 'ENOENT')
  );
}

async function readTemplateFile(
  path: string,
): Promise<{ name: string; agents: AgentConfig[] } | null> {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as { name: string; agents: AgentConfig[] };
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }
}

function createProjectConfigFromTemplate(template: {
  name: string;
  agents: AgentConfig[];
}): ProjectConfig {
  return {
    team: {
      name: template.name,
      agents: template.agents.map((agent) => ({ ...agent })),
    },
    consensus: { ...DEFAULT_CONSENSUS },
    sandbox: { ...DEFAULT_SANDBOX },
    fileAccess: {
      denyList: [...DEFAULT_FILE_ACCESS.denyList],
    },
  };
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
