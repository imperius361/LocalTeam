import { randomUUID } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import {
  readWorkspaceConfig,
  writeWorkspaceConfig,
} from './persistence.js';
import type { IpcNotification } from './protocol.js';
import { NemoclawGatewayBridge } from './gateway-bridge.js';
import {
  normalizeProjectConfig,
  parseProjectConfig,
  validateProjectConfig,
} from './team-config.js';
import { canonicalizeWorkspacePath } from './workspace-path.js';
import type {
  AgentMessage,
  AgentStatus,
  CommandApproval,
  ProjectConfig,
  ProjectSnapshot,
  SessionState,
  TemplateSummary,
} from './types.js';

const DEFAULT_TEMPLATE_FILE = 'default-team.json';
const DEFAULT_VERSION = '0.3.0';
const DEFAULT_FILE_ACCESS = {
  denyList: [
    '.env',
    '.env.*',
    '.git',
    '.git/',
    '.git-credentials',
    '.npmrc',
    '.pypirc',
    '.ssh',
    '.ssh/',
    'credentials*',
    '*.key',
    '*.pem',
    '*.p12',
    '*.pfx',
    '*.tfstate',
    '*.tfstate.*',
  ],
};
const DEFAULT_SANDBOX = {
  defaultMode: 'worktree',
  useWorktrees: true,
};
const FALLBACK_DEFAULT_TEAM: ProjectConfig = normalizeProjectConfig({
  version: 2,
  defaultTeamId: 'default-localteam',
  teams: [
    {
      id: 'default-localteam',
      name: 'Default LocalTeam',
      workspaceMode: 'shared_project',
      members: [
        {
          id: 'architect',
          role: 'Software Architect',
          systemPrompt:
            'You are the lead architect. Drive the plan, decompose work, and keep the team aligned on scope and tradeoffs.',
          runtimeProfileRef: null,
          runtimeHint: {
            provider: 'nemoclaw',
            model: 'openclaw-local',
          },
          tools: ['read_file', 'search_code', 'propose_task'],
          allowedPaths: ['src/', 'src-sidecar/', 'src-tauri/', 'docs/'],
          canExecuteCommands: false,
        },
      ],
    },
  ],
  sandbox: DEFAULT_SANDBOX,
  fileAccess: DEFAULT_FILE_ACCESS,
});

export class LocalTeamRuntime {
  private readonly startedAt = Date.now();
  private readonly defaultProjectRoot = resolveDefaultProjectRoot();
  private readonly templatesDir = resolveTemplatesDirectory(this.defaultProjectRoot);
  private readonly gateway = new NemoclawGatewayBridge();

  private projectRoot: string | null = null;
  private config: ProjectConfig | null = null;
  private session: SessionState | null = null;
  private lastError?: string;

  constructor(private readonly notify: (notification: IpcNotification) => void) {}

  async status(): Promise<ProjectSnapshot> {
    return this.getSnapshot();
  }

  dispose(): void {
    this.projectRoot = null;
    this.config = null;
    this.session = null;
    this.lastError = undefined;
  }

  async loadProject(rootPath?: string): Promise<ProjectSnapshot> {
    const selectedRoot = rootPath?.trim() || this.projectRoot || this.defaultProjectRoot;
    if (!selectedRoot) {
      const snapshot = await this.getSnapshot();
      this.emitSnapshot(snapshot);
      return snapshot;
    }

    const projectRoot = await resolveGitWorkspaceRoot(selectedRoot);
    if (!projectRoot) {
      throw new Error(`Selected folder is not a git workspace: ${selectedRoot}`);
    }

    this.projectRoot = projectRoot;
    this.config = await this.loadWorkspaceConfig(projectRoot);
    if (this.session && this.session.projectRoot !== projectRoot) {
      this.session = null;
    }

    const snapshot = await this.getSnapshot();
    this.emitSnapshot(snapshot);
    return snapshot;
  }

  async saveProject(config: ProjectConfig): Promise<ProjectSnapshot> {
    const errors = validateProjectConfig(config);
    if (errors.length > 0) {
      throw new Error(`Invalid workspace config: ${errors.join('; ')}`);
    }

    if (!this.projectRoot) {
      throw new Error('No git workspace selected');
    }

    await writeWorkspaceConfig(this.projectRoot, config);
    this.config = config;
    const snapshot = await this.getSnapshot();
    this.emitSnapshot(snapshot);
    return snapshot;
  }

  async listTemplates(): Promise<TemplateSummary[]> {
    return this.refreshTemplates();
  }

  async getTemplate(id: string): Promise<ProjectConfig> {
    const raw = await readFile(join(this.templatesDir, `${id}.json`), 'utf8');
    return createProjectConfigFromTemplate(JSON.parse(raw));
  }

  async getNemoclawStatus(): Promise<Record<string, unknown>> {
    const gateway = await this.gateway.getStatus(this.projectRoot);
    const config = this.config;
    const activeTeamId = this.gateway.getActiveTeamId() ?? config?.defaultTeamId ?? null;
    return {
      gateway,
      activeTeamId,
      runtimeProfiles: await this.gateway.listProfiles(),
      sessions: this.gateway.listSessions(),
      approvals: this.gateway.listApprovals(),
    };
  }

  async listRuntimeProfiles(): Promise<unknown[]> {
    return this.gateway.listProfiles();
  }

  async applyTeam(teamId?: string): Promise<ProjectSnapshot> {
    const config = this.ensureConfig();
    const team = selectTeam(config, teamId);
    if (!team) {
      throw new Error('No team is available to apply');
    }

    await this.gateway.applyTeam(team.id);
    const snapshot = await this.getSnapshot();
    this.notify({
      method: 'v1.nemoclaw.team.applied',
      params: { teamId: team.id },
    });
    this.emitSnapshot(snapshot);
    return snapshot;
  }

  async startSession(teamId?: string): Promise<ProjectSnapshot> {
    const config = this.ensureConfig();
    const team = selectTeam(config, teamId);
    if (!team) {
      throw new Error('No team is available to start a session');
    }

    await this.gateway.applyTeam(team.id);
    const gatewaySession = await this.gateway.startSession(team.id, team.name, team.members);
    this.session = {
      id: gatewaySession.id,
      projectRoot: this.projectRoot ?? '',
      projectName: team.name,
      teamId: team.id,
      createdAt: gatewaySession.createdAt,
      updatedAt: gatewaySession.updatedAt,
      status: 'running',
    };

    const snapshot = await this.getSnapshot();
    this.notify({
      method: 'v1.session.updated',
      params: { session: this.session },
    });
    this.emitSnapshot(snapshot);
    return snapshot;
  }

  async stopSession(sessionId?: string): Promise<ProjectSnapshot> {
    const currentSessionId = sessionId ?? this.session?.id;
    if (!currentSessionId) {
      throw new Error('No active session to stop');
    }

    const stopped = await this.gateway.stopSession(currentSessionId);
    if (!stopped) {
      throw new Error(`Unknown session: ${currentSessionId}`);
    }

    if (this.session?.id === currentSessionId) {
      this.session = {
        ...this.session,
        updatedAt: stopped.updatedAt,
        status: 'idle',
      };
    }

    const snapshot = await this.getSnapshot();
    this.notify({
      method: 'v1.session.updated',
      params: { session: this.session },
    });
    this.emitSnapshot(snapshot);
    return snapshot;
  }

  async listSessions(): Promise<unknown[]> {
    return this.gateway.listSessions();
  }

  async observeSession(sessionId?: string): Promise<unknown[]> {
    return this.gateway.listEvents(sessionId);
  }

  async listApprovals(): Promise<unknown[]> {
    return this.gateway.listApprovals();
  }

  async listCommandApprovals(taskId?: string): Promise<CommandApproval[]> {
    const approvals = this.gateway.listApprovals().map((approval) =>
      mapApprovalToCommandApproval(approval, this.projectRoot),
    );
    if (!taskId) {
      return approvals;
    }
    return approvals.filter((approval) => approval.taskId === taskId);
  }

  async resolveApproval(
    approvalId: string,
    action: 'approve' | 'deny',
  ): Promise<CommandApproval> {
    const approval = await this.gateway.resolveApproval(approvalId, action);
    if (!approval) {
      throw new Error(`Unknown approval: ${approvalId}`);
    }
    return mapApprovalToCommandApproval(approval, this.projectRoot);
  }

  private ensureConfig(): ProjectConfig {
    if (!this.config) {
      throw new Error('No project configuration loaded');
    }
    return this.config;
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

  private async createDefaultProjectConfig(): Promise<ProjectConfig> {
    const template = await readTemplateFile(join(this.templatesDir, DEFAULT_TEMPLATE_FILE));
    if (template) {
      return createProjectConfigFromTemplate(template);
    }

    return FALLBACK_DEFAULT_TEAM;
  }

  private async refreshTemplates(): Promise<TemplateSummary[]> {
    let entries: { name: string }[] = [];
    try {
      entries = await readdir(this.templatesDir, { withFileTypes: true }) as any;
    } catch {
      return [];
    }

    const templates: TemplateSummary[] = [];
    for (const entry of entries) {
      if (!entry.name.endsWith('.json')) {
        continue;
      }
      const raw = await readFile(join(this.templatesDir, entry.name), 'utf8');
      const config = createProjectConfigFromTemplate(JSON.parse(raw));
      templates.push({
        id: entry.name.replace(/\.json$/i, ''),
        name: selectTeam(config)?.name ?? entry.name.replace(/\.json$/i, ''),
        description: `Built-in template: ${entry.name.replace(/\.json$/i, '')}`,
        path: join(this.templatesDir, entry.name),
        runtimeProfiles: uniqueRuntimeProfiles(config),
      } as any);
    }

    return templates.sort((left, right) => left.name.localeCompare(right.name));
  }

  private async getSnapshot(): Promise<ProjectSnapshot> {
    const gatewayStatus = await this.gateway.getStatus(this.projectRoot);
    const runtimeProfiles = await this.gateway.listProfiles();
    const team = selectTeam(
      this.config,
      this.gateway.getActiveTeamId() ?? this.session?.teamId ?? undefined,
    );

    const messages = this.gateway.listEvents(this.session?.id).map<AgentMessage>((event) => ({
      id: event.id,
      agentId: event.agentId ?? 'nemoclaw',
      agentRole: event.agentRole ?? 'Nemoclaw',
      type: event.type === 'system' ? 'system' : 'discussion',
      content: event.content,
      timestamp: event.timestamp,
    }));
    const commandApprovals = this.gateway.listApprovals().map((approval) =>
      mapApprovalToCommandApproval(approval, this.projectRoot),
    );

    const agentStatuses = (team?.members ?? []).map<AgentStatus>((member) => {
      const profile = runtimeProfiles.find((entry) => entry.id === member.runtimeProfileRef);
      return {
        agentId: member.id,
        role: member.role,
        model: profile?.model ?? member.runtimeHint?.model ?? 'unbound',
        provider: profile?.provider ?? member.runtimeHint?.provider ?? 'nemoclaw',
        backend: 'nemoclaw',
        status: this.session?.status === 'running' ? 'idle' : 'unavailable',
        hasCredentials: gatewayStatus.ready && profile?.availability !== 'missing',
        ...(member.runtimeProfileRef
          ? {}
          : { lastError: 'Member is not bound to a Nemoclaw runtime profile.' }),
      };
    });

    return {
      version: 'v1',
      projectRoot: this.projectRoot,
      config: this.config,
      session: this.session,
      tasks: [],
      messages,
      consensus: [],
      agentStatuses,
      credentials: [],
      templates: await this.refreshTemplates(),
      commandApprovals,
      sidecar: {
        ready: true,
        version: DEFAULT_VERSION,
        uptime: Date.now() - this.startedAt,
        ...(this.lastError ? { lastError: this.lastError } : {}),
      },
      gateway: gatewayStatus,
      runtimeProfiles,
      sessions: this.gateway.listSessions(),
      approvals: this.gateway.listApprovals(),
      activeTeamId: team?.id ?? null,
    } as ProjectSnapshot;
  }

  private emitSnapshot(snapshot: ProjectSnapshot): void {
    this.notify({
      method: 'v1.snapshot',
      params: { snapshot },
    });
    this.notify({
      method: 'v1.nemoclaw.status',
      params: {
        gateway: (snapshot as any).gateway,
        runtimeProfiles: (snapshot as any).runtimeProfiles,
        sessions: (snapshot as any).sessions,
        approvals: (snapshot as any).approvals,
        activeTeamId: (snapshot as any).activeTeamId,
      },
    });
  }
}

function mapApprovalToCommandApproval(
  approval: ReturnType<NemoclawGatewayBridge['listApprovals']>[number],
  projectRoot: string | null,
): CommandApproval {
  return {
    id: approval.id,
    taskId: `session:${approval.sessionId}`,
    agentId: approval.agentId ?? 'nemoclaw',
    agentRole: approval.agentRole ?? 'Nemoclaw',
    command: approval.command ?? approval.summary,
    effectiveCwd: projectRoot ?? '',
    status:
      approval.status === 'approved'
        ? 'approved'
        : approval.status === 'denied'
          ? 'denied'
          : 'pending',
    requiresApproval: true,
    preApproved: false,
    reason: approval.summary,
    requestedAt: approval.requestedAt,
    updatedAt: approval.updatedAt,
    policy: {
      sandboxMode: 'worktree',
      checkedPaths: [],
      allowedPaths: [],
    },
  };
}

function selectTeam(
  config: ProjectConfig | null | undefined,
  requestedTeamId?: string,
): ProjectConfig['teams'][number] | null {
  if (!config) {
    return null;
  }

  const found = requestedTeamId
    ? config.teams.find((team) => team.id === requestedTeamId)
    : config.teams.find((team) => team.id === config.defaultTeamId);
  return found ?? config.teams[0] ?? null;
}

function uniqueRuntimeProfiles(config: ProjectConfig): string[] {
  const ids = new Set<string>();
  for (const team of config.teams) {
    for (const member of team.members) {
      if (member.runtimeProfileRef) {
        ids.add(member.runtimeProfileRef);
      }
    }
  }
  return [...ids];
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

async function readTemplateFile(path: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }
}

function createProjectConfigFromTemplate(template: Record<string, unknown>): ProjectConfig {
  const normalized = normalizeProjectConfig(
    template && typeof template === 'object'
      ? {
          ...template,
          sandbox: {
            ...DEFAULT_SANDBOX,
            ...(((template as any).sandbox ?? {}) as Record<string, unknown>),
          },
          fileAccess: {
            denyList: Array.isArray((template as any).fileAccess?.denyList)
              ? (template as any).fileAccess.denyList
              : [...DEFAULT_FILE_ACCESS.denyList],
          },
        }
      : FALLBACK_DEFAULT_TEAM,
  );

  return normalized;
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
