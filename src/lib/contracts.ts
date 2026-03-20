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
