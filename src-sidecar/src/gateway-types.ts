export interface RuntimeProfileSummary {
  id: string;
  label: string;
  provider: string;
  model: string;
  availability: 'ready' | 'missing';
}

export interface NemoclawStateFile {
  onboardingCompleted: boolean;
  updatedAt: number;
  profiles: RuntimeProfileSummary[];
  lastError?: string;
}

export interface NemoclawGatewayStatus {
  ready: boolean;
  onboardingCompleted: boolean;
  profileCount: number;
  workspaceRoot: string | null;
  lastError?: string;
}

export interface NemoclawSessionEvent {
  id: string;
  sessionId: string;
  type: 'system' | 'message';
  content: string;
  timestamp: number;
  agentId?: string;
  agentRole?: string;
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
