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

export interface ProjectConfig {
  team: {
    name: string;
    agents: AgentConfig[];
  };
  consensus: {
    maxRounds: number;
    requiredMajority: number;
  };
  sandbox: {
    defaultMode: 'direct' | 'worktree';
    useWorktrees: boolean;
  };
  fileAccess: {
    denyList: string[];
  };
}

export interface AgentMessage {
  id: string;
  agentId: string;
  agentRole: string;
  type:
    | 'discussion'
    | 'proposal'
    | 'objection'
    | 'consensus'
    | 'artifact'
    | 'user'
    | 'system';
  content: string;
  timestamp: number;
  taskId?: string;
  round?: number;
  tokenEstimate?: number;
  meta?: Record<string, unknown>;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'review' | 'completed';
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

export interface AgentStatus {
  agentId: string;
  role: string;
  model: string;
  provider: ProviderId;
  status:
    | 'idle'
    | 'thinking'
    | 'writing'
    | 'waiting_for_consensus'
    | 'unavailable';
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
  provider: 'anthropic' | 'openai';
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
    sandboxMode: ProjectConfig['sandbox']['defaultMode'];
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

export interface SidecarNotification {
  method: string;
  params: Record<string, unknown>;
}

// Multi-project UI types

export interface RecentProject {
  path: string;          // absolute path to directory containing localteam.json
  name: string;          // from ProjectConfig.team.name
  lastOpenedAt: number;  // unix ms timestamp
}

// Derived UI model — built from ProjectSnapshot + RecentProject
export interface UIProject {
  id: string;            // btoa(path) — simple stable hash of path
  name: string;
  path: string;
  status: 'active' | 'error' | 'idle';
  teams: UITeam[];
  snapshot: ProjectSnapshot | null;
  lastOpenedAt: number;
}

export interface UITeam {
  id: string;            // derived: `${projectId}:${name}`
  name: string;
  projectId: string;     // matches UIProject.id
  agents: AgentStatus[];
}
