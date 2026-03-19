export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentConfig {
  id: string;
  role: string;
  model: string;
  provider: 'anthropic' | 'openai';
  systemPrompt: string;
  tools?: string[];
  allowedPaths?: string[];
  canExecuteCommands?: boolean;
}

export interface AgentMessage {
  id: string;
  agentId: string;
  agentRole: string;
  type: 'discussion' | 'proposal' | 'objection' | 'consensus' | 'artifact';
  content: string;
  timestamp: number;
  taskId?: string;
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
}

export interface ConsensusConfig {
  maxRounds: number;
  requiredMajority: number;
}

export interface TeamConfig {
  name: string;
  agents: AgentConfig[];
  consensus: ConsensusConfig;
}
