import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type {
  NemoclawApprovalSummary,
  NemoclawGatewayStatus,
  NemoclawSessionEvent,
  NemoclawSessionSummary,
  NemoclawStateFile,
  RuntimeProfileSummary,
} from './gateway-types.js';

const NEMOCLAW_STATE_FILE = 'nemoclaw-state.json';

const DEFAULT_STATE: NemoclawStateFile = {
  onboardingCompleted: false,
  updatedAt: 0,
  profiles: [],
};

function resolveAppDataDirectory(): string {
  const configured = process.env.LOCALTEAM_APP_DATA_DIR?.trim();
  if (configured) {
    return resolve(configured);
  }

  return join(tmpdir(), 'localteam');
}

export class NemoclawGatewayBridge {
  private activeTeamId: string | null = null;
  private sessions = new Map<string, NemoclawSessionSummary>();
  private events = new Map<string, NemoclawSessionEvent[]>();
  private approvals = new Map<string, NemoclawApprovalSummary>();

  async getStatus(workspaceRoot: string | null): Promise<NemoclawGatewayStatus> {
    const state = await this.readState();
    return {
      ready: state.onboardingCompleted,
      onboardingCompleted: state.onboardingCompleted,
      profileCount: state.profiles.length,
      workspaceRoot,
      ...(state.lastError ? { lastError: state.lastError } : {}),
    };
  }

  async listProfiles(): Promise<RuntimeProfileSummary[]> {
    const state = await this.readState();
    return state.profiles;
  }

  async applyTeam(teamId: string): Promise<{ teamId: string; appliedAt: number }> {
    this.activeTeamId = teamId;
    return { teamId, appliedAt: Date.now() };
  }

  getActiveTeamId(): string | null {
    return this.activeTeamId;
  }

  async startSession(
    teamId: string,
    title: string,
    members: Array<{ id: string; role: string; canExecuteCommands?: boolean }>,
  ): Promise<NemoclawSessionSummary> {
    const now = Date.now();
    const session: NemoclawSessionSummary = {
      id: randomUUID(),
      teamId,
      title,
      status: 'running',
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(session.id, session);
    const sessionEvents: NemoclawSessionEvent[] = [
      {
        id: randomUUID(),
        sessionId: session.id,
        type: 'system',
        content: `Nemoclaw session started for team ${teamId}.`,
        timestamp: now,
      },
      ...members.map((member, index) => ({
        id: randomUUID(),
        sessionId: session.id,
        type: 'message' as const,
        content: `${member.role} is connected through Nemoclaw and ready for the shared workspace.`,
        timestamp: now + index + 1,
        agentId: member.id,
        agentRole: member.role,
      })),
    ];
    this.events.set(session.id, sessionEvents);

    const approvalMember = members.find((member) => member.canExecuteCommands) ?? members[0];
    if (approvalMember) {
      const requestedAt = now + sessionEvents.length + 1;
      const approvalId = randomUUID();
      this.approvals.set(approvalId, {
        id: approvalId,
        sessionId: session.id,
        summary: `${approvalMember.role} requests approval for a workspace inspection command.`,
        status: 'pending',
        requestedAt,
        updatedAt: requestedAt,
        agentId: approvalMember.id,
        agentRole: approvalMember.role,
        command: 'git status --short',
      });
    }
    return session;
  }

  async stopSession(sessionId: string): Promise<NemoclawSessionSummary | null> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return null;
    }
    const next: NemoclawSessionSummary = {
      ...session,
      status: 'stopped',
      updatedAt: Date.now(),
    };
    this.sessions.set(sessionId, next);
    const items = this.events.get(sessionId) ?? [];
    items.push({
      id: randomUUID(),
      sessionId,
      type: 'system',
      content: `Nemoclaw session ${sessionId} stopped.`,
      timestamp: next.updatedAt,
    });
    this.events.set(sessionId, items);
    return next;
  }

  listSessions(): NemoclawSessionSummary[] {
    return [...this.sessions.values()].sort((left, right) => right.updatedAt - left.updatedAt);
  }

  listEvents(sessionId?: string): NemoclawSessionEvent[] {
    if (sessionId) {
      return [...(this.events.get(sessionId) ?? [])];
    }
    return [...this.events.values()].flat().sort((left, right) => left.timestamp - right.timestamp);
  }

  listApprovals(): NemoclawApprovalSummary[] {
    return [...this.approvals.values()].sort((left, right) => left.requestedAt - right.requestedAt);
  }

  async resolveApproval(
    approvalId: string,
    action: 'approve' | 'deny',
  ): Promise<NemoclawApprovalSummary | null> {
    const approval = this.approvals.get(approvalId);
    if (!approval) {
      return null;
    }

    const next: NemoclawApprovalSummary = {
      ...approval,
      status: action === 'approve' ? 'approved' : 'denied',
      updatedAt: Date.now(),
    };
    this.approvals.set(approvalId, next);

    const items = this.events.get(approval.sessionId) ?? [];
    items.push({
      id: randomUUID(),
      sessionId: approval.sessionId,
      type: 'system',
      content: `${approval.agentRole ?? 'Nemoclaw'} approval ${action}d.`,
      timestamp: next.updatedAt,
    });
    this.events.set(approval.sessionId, items);

    return next;
  }

  private async readState(): Promise<NemoclawStateFile> {
    try {
      const raw = await readFile(join(resolveAppDataDirectory(), NEMOCLAW_STATE_FILE), 'utf8');
      const parsed = JSON.parse(raw) as Partial<NemoclawStateFile>;
      return {
        onboardingCompleted: parsed.onboardingCompleted === true,
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
        profiles: Array.isArray(parsed.profiles)
          ? parsed.profiles.map((profile) => ({
              id: String(profile.id),
              label: String(profile.label),
              provider: String(profile.provider),
              model: String(profile.model),
              availability: profile.availability === 'missing' ? 'missing' : 'ready',
            }))
          : [],
        ...(typeof parsed.lastError === 'string' ? { lastError: parsed.lastError } : {}),
      };
    } catch {
      return DEFAULT_STATE;
    }
  }
}
