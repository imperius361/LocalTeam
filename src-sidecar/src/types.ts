export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type ProviderId = 'anthropic' | 'openai' | 'mock';

export interface AgentConfig {
  id: string;
  role: string;
  model: string;
  provider: ProviderId;
  systemPrompt: string;
  tools?: string[];
  allowedPaths?: string[];
  canExecuteCommands?: boolean;
  preApprovedCommands?: string[];
}

export type AgentMessageType =
  | 'discussion'
  | 'proposal'
  | 'objection'
  | 'consensus'
  | 'artifact'
  | 'user'
  | 'system';

export interface AgentMessage {
  id: string;
  agentId: string;
  agentRole: string;
  type: AgentMessageType;
  content: string;
  timestamp: number;
  taskId?: string;
  round?: number;
  tokenEstimate?: number;
  meta?: Record<string, unknown>;
}

export type TaskStatus = 'pending' | 'in_progress' | 'review' | 'completed';

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  assignedAgents: string[];
  parentTaskId?: string;
  createdAt: number;
  updatedAt: number;
  tokenEstimate: number;
  sessionId?: string;
  consensusState?: 'pending' | 'reached' | 'escalated';
  sandboxPath?: string;
  sandboxDiffStat?: string;
}

export interface ConsensusConfig {
  maxRounds: number;
  requiredMajority: number;
}

export interface TeamDefinition {
  name: string;
  agents: AgentConfig[];
}

export interface SandboxConfig {
  defaultMode: 'direct' | 'worktree';
  useWorktrees: boolean;
}

export interface FileAccessConfig {
  denyList: string[];
}

export interface ProjectConfig {
  team: TeamDefinition;
  consensus: ConsensusConfig;
  sandbox: SandboxConfig;
  fileAccess: FileAccessConfig;
}

export type TeamConfig = TeamDefinition;

export type AgentRuntimeState =
  | 'idle'
  | 'thinking'
  | 'writing'
  | 'waiting_for_consensus'
  | 'unavailable';

export interface AgentStatus {
  agentId: string;
  role: string;
  model: string;
  provider: ProviderId;
  status: AgentRuntimeState;
  hasCredentials: boolean;
  lastError?: string;
}

export interface ConsensusPosition {
  agentId: string;
  position: string;
  agrees: boolean;
}

export interface ConsensusState {
  taskId: string;
  round: number;
  status: 'pending' | 'reached' | 'escalated';
  supporters: string[];
  summary: ConsensusPosition[];
  updatedAt: number;
}

export interface SessionState {
  id: string;
  projectRoot: string;
  projectName: string;
  createdAt: number;
  updatedAt: number;
  status: 'idle' | 'running' | 'awaiting_user';
}

export interface ProviderCredentialStatus {
  provider: Exclude<ProviderId, 'mock'>;
  hasKey: boolean;
  syncedAt?: number;
}

export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  path: string;
  providers: ProviderId[];
}

export interface MessageStreamDelta {
  messageId: string;
  taskId: string;
  agentId: string;
  agentRole: string;
  round: number;
  delta: string;
  content: string;
  timestamp: number;
}

export interface MessageStreamFinalization {
  messageId: string;
  taskId: string;
  agentId: string;
  round: number;
  timestamp: number;
}

export type CommandApprovalStatus =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'completed'
  | 'failed';

export interface CommandExecutionRequest {
  taskId: string;
  agentId: string;
  command: string;
  cwd?: string;
}

export interface TaskInterjectionRequest {
  taskId: string;
  guidance: string;
}

export interface CommandApproval {
  id: string;
  taskId: string;
  agentId: string;
  agentRole: string;
  command: string;
  requestedCwd?: string;
  effectiveCwd: string;
  status: CommandApprovalStatus;
  requiresApproval: boolean;
  preApproved: boolean;
  reason?: string;
  requestedAt: number;
  updatedAt: number;
  decidedAt?: number;
  completedAt?: number;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  policy: {
    sandboxMode: SandboxConfig['defaultMode'];
    checkedPaths: string[];
    allowedPaths: string[];
    matchedDenyRule?: string;
  };
}

export interface ProjectSnapshot {
  version: 'v1';
  projectRoot: string | null;
  config: ProjectConfig | null;
  session: SessionState | null;
  tasks: Task[];
  messages: AgentMessage[];
  consensus: ConsensusState[];
  agentStatuses: AgentStatus[];
  credentials: ProviderCredentialStatus[];
  templates: TemplateSummary[];
  commandApprovals: CommandApproval[];
  sidecar: {
    ready: boolean;
    version: string;
    uptime: number;
    lastError?: string;
  };
}
