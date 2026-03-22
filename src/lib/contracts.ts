export interface RuntimeHint {
  provider?: string;
  model?: string;
}

export interface TeamMemberConfig {
  id: string;
  role: string;
  systemPrompt: string;
  runtimeProfileRef: string | null;
  runtimeHint?: RuntimeHint;
  tools?: string[];
  allowedPaths?: string[];
  canExecuteCommands?: boolean;
  preApprovedCommands?: string[];
}

export type AgentConfig = TeamMemberConfig;

export interface ProjectConfig {
  version: 2;
  defaultTeamId: string | null;
  teams: TeamConfig[];
  consensus?: {
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

export interface TeamConfig {
  id: string;
  name: string;
  workspaceMode: 'shared_project';
  members: TeamMemberConfig[];
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
  meta?: AgentMessageMeta;
}

export type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'review'
  | 'completed'
  | 'cancelled';

export type TaskOrigin = 'user_request' | 'agent_subtask';

export type TaskReviewAction = 'approve' | 'modify' | 'reject';

export interface TaskReviewSummary {
  proposalMessageId: string;
  summaryText: string;
  presentedAt: number;
  lastUserAction?: TaskReviewAction;
}

export interface MessageFlowMeta {
  fromId: string;
  toId: string;
  edgeLabel: string;
  phase: 'request' | 'planning' | 'review' | 'execution';
  audience: 'manager' | 'user';
  round?: number;
}

export interface AgentMessageMeta extends Record<string, unknown> {
  flow?: MessageFlowMeta;
}

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
  origin: TaskOrigin;
  createdByAgentId?: string;
  managerAgentId?: string;
  reviewSummary?: TaskReviewSummary;
}

export interface AgentStatus {
  agentId: string;
  role: string;
  model: string;
  provider: string;
  backend: 'nemoclaw';
  status:
    | 'idle'
    | 'thinking'
    | 'writing'
    | 'waiting_for_consensus'
    | 'unavailable';
  hasCredentials: boolean;
  lastError?: string;
}

export interface RuntimeProfileSummary {
  id: string;
  label: string;
  provider: string;
  model: string;
  availability: 'ready' | 'missing';
}

export interface NemoclawGatewayStatus {
  ready: boolean;
  onboardingCompleted: boolean;
  profileCount: number;
  workspaceRoot: string | null;
  lastError?: string;
}

export interface NemoclawSessionSummary {
  id: string;
  teamId: string;
  title: string;
  status: 'running' | 'stopped';
  createdAt: number;
  updatedAt: number;
}

export interface NemoclawApprovalSummary {
  id: string;
  sessionId: string;
  summary: string;
  status: 'pending' | 'approved' | 'denied';
  requestedAt: number;
  updatedAt: number;
  agentId?: string;
  agentRole?: string;
  command?: string;
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
  teamId?: string;
  createdAt: number;
  updatedAt: number;
  status: 'idle' | 'running' | 'awaiting_user';
}

export interface ProviderCredentialStatus {
  provider: string;
  hasKey: boolean;
  syncedAt?: number;
}

export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  path: string;
  runtimeProfiles: string[];
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
  meta?: AgentMessageMeta;
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
  gateway?: NemoclawGatewayStatus;
  runtimeProfiles?: RuntimeProfileSummary[];
  sessions?: NemoclawSessionSummary[];
  approvals?: NemoclawApprovalSummary[];
  activeTeamId?: string | null;
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
  name: string;          // from ProjectConfig.defaultTeamId or first team name
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
