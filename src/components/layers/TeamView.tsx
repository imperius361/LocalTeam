import React, { useMemo, useState } from 'react';

import { useNav } from '../../navigation/NavContext';
import {
  applyNemoclawTeam,
  resolveCommandApproval,
  startSession,
  stopSession,
} from '../../lib/ipc';
import { CommandApprovalsPanel } from '../CommandApprovalsPanel';
import { StatusBadge } from '../common/StatusBadge';
import { useAppStore } from '../../store/appStore';
import type { AgentStatus, TeamMemberConfig } from '../../lib/contracts';

export function TeamView(): React.ReactElement {
  const { navState, navigate } = useNav();
  const snapshot = useAppStore((s) => s.snapshot);
  const teamMap = useAppStore((s) => s.teamMap);
  const agentStatusMap = useAppStore((s) => s.agentStatusMap);
  const patchSnapshot = useAppStore((s) => s.patchSnapshot);
  const setSnapshot = useAppStore((s) => s.setSnapshot);

  const projectPath = navState.layer === 'team' ? navState.projectPath : '';
  const teamId = navState.layer === 'team' ? navState.teamId : '';
  const team = teamMap[teamId] ?? snapshot?.config?.teams.find((entry) => entry.id === teamId) ?? null;
  const [busyApprovalId, setBusyApprovalId] = useState<string | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [runtimeBusy, setRuntimeBusy] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);

  const memberIds = team?.members.map((member) => member.id) ?? [];
  const recentMessages = useMemo(
    () =>
      [...(snapshot?.messages ?? [])]
        .filter((message) => memberIds.includes(message.agentId))
        .sort((left, right) => right.timestamp - left.timestamp)
        .slice(0, 12),
    [memberIds, snapshot?.messages],
  );
  const approvals = (snapshot?.commandApprovals ?? []).filter((approval) =>
    memberIds.includes(approval.agentId),
  );
  const teamTasks = (snapshot?.tasks ?? []).filter((task) =>
    task.assignedAgents.some((agentId) => memberIds.includes(agentId)),
  );
  const connectedMembers = memberIds.filter((id) => agentStatusMap[id]).length;
  const boundMembers = team?.members.filter((member) => member.runtimeProfileRef).length ?? 0;
  const pendingApprovals = approvals.filter((approval) => approval.status === 'pending').length;
  const activeSession =
    snapshot?.session && (snapshot.session.teamId === teamId || (!snapshot.session.teamId && (snapshot.config?.teams.length ?? 0) === 1))
      ? snapshot.session
      : null;

  async function handleApplyTeam(): Promise<void> {
    setRuntimeBusy(true);
    setRuntimeError(null);

    try {
      setSnapshot(await applyNemoclawTeam(teamId));
    } catch (error) {
      setRuntimeError(
        error instanceof Error && error.message.trim()
          ? error.message
          : 'Failed to apply team.',
      );
    } finally {
      setRuntimeBusy(false);
    }
  }

  async function handleSessionAction(action: 'start' | 'stop'): Promise<void> {
    setRuntimeBusy(true);
    setRuntimeError(null);

    try {
      const nextSnapshot = action === 'start'
        ? await startSession(teamId)
        : await stopSession(activeSession?.id);
      setSnapshot(nextSnapshot);
    } catch (error) {
      setRuntimeError(
        error instanceof Error && error.message.trim()
          ? error.message
          : `Failed to ${action} session.`,
      );
    } finally {
      setRuntimeBusy(false);
    }
  }

  async function handleApprovalAction(
    approvalId: string,
    action: 'approve' | 'deny',
  ): Promise<void> {
    setBusyApprovalId(approvalId);
    setApprovalError(null);

    try {
      const approval = await resolveCommandApproval(approvalId, action);
      patchSnapshot((current) => {
        if (!current) {
          return current;
        }

        const existing = current.commandApprovals.filter((entry) => entry.id !== approval.id);
        return {
          ...current,
          commandApprovals: [...existing, approval].sort(
            (left, right) => left.requestedAt - right.requestedAt,
          ),
        };
      });
    } catch (error) {
      setApprovalError(
        error instanceof Error && error.message.trim()
          ? error.message
          : 'Approval update failed.',
      );
    } finally {
      setBusyApprovalId(null);
    }
  }

  if (!team) {
    return <div style={emptyStateStyle}>Team not found: {teamId}</div>;
  }

  return (
    <div
      style={{
        display: 'flex',
        flex: 1,
        minHeight: 0,
        background: 'var(--bg-base)',
        gap: '16px',
        padding: '16px',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          flex: 1.2,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          overflowY: 'auto',
        }}
      >
        <section style={panelStyle}>
          <div className="panel-header">
            <h2>{team.name}</h2>
            <span>{team.workspaceMode}</span>
          </div>
          <p style={copyStyle}>
            LocalTeam owns this team definition. Nemoclaw resolves each member binding to a local
            or hosted model route through the managed gateway.
          </p>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
            <button
              className="secondary-button"
              type="button"
              disabled={runtimeBusy}
              onClick={() => {
                void handleApplyTeam();
              }}
            >
              Apply Team
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={runtimeBusy}
              onClick={() => {
                void handleSessionAction(activeSession ? 'stop' : 'start');
              }}
            >
              {activeSession ? 'Stop Session' : 'Start Session'}
            </button>
          </div>
          {runtimeError && <p className="recovery-copy settings-error">{runtimeError}</p>}
          <div style={metricsGridStyle}>
            <Metric label="Members" value={String(team.members.length)} />
            <Metric label="Bound profiles" value={String(boundMembers)} />
            <Metric label="Connected" value={String(connectedMembers)} />
            <Metric label="Pending approvals" value={String(pendingApprovals)} />
            <Metric label="Session" value={activeSession?.status ?? 'Not started'} />
          </div>
        </section>

        <section>
          <div style={sectionHeaderStyle}>Team Members</div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: '12px',
            }}
          >
            {team.members.map((member) => {
              const status = resolveMemberStatus(member, agentStatusMap[member.id]);
              return (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => navigate({ layer: 'agent', projectPath, teamId, agentId: member.id })}
                  style={{
                    ...panelStyle,
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '8px',
                      marginBottom: '10px',
                    }}
                  >
                    <strong style={{ fontSize: '13px' }}>{member.role}</strong>
                    <StatusBadge status={status.status} />
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '6px' }}>
                    {member.runtimeProfileRef ?? 'No runtime profile ref'}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
                    <span style={chipStyle('var(--accent)')}>{status.provider}</span>
                    <span style={chipStyle('var(--text-muted)')}>{status.model}</span>
                    {member.canExecuteCommands && (
                      <span style={chipStyle('var(--yellow)')}>Commands enabled</span>
                    )}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {trimText(member.systemPrompt, 120)}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section style={{ ...panelStyle, minHeight: 0 }}>
          <div className="panel-header">
            <h3>Recent Team Activity</h3>
            <span>{recentMessages.length} entries</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {recentMessages.length === 0 ? (
              <div style={emptyStateStyle}>No team activity recorded yet.</div>
            ) : (
              recentMessages.map((message) => (
                <div key={message.id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                    {message.agentRole} • {message.type}
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    {trimText(message.content, 160)}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <div
        style={{
          width: 420,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          overflowY: 'auto',
        }}
      >
        <section style={panelStyle}>
          <div className="panel-header">
            <h3>Gateway Summary</h3>
            <span>{snapshot?.sidecar.ready ? 'Online' : 'Offline'}</span>
          </div>
          <div style={{ display: 'grid', gap: '8px', fontSize: '11px', color: 'var(--text-secondary)' }}>
            <div>Team id: {team.id}</div>
            <div>Workspace mode: {team.workspaceMode}</div>
            <div>Session status: {activeSession?.status ?? 'Not started'}</div>
            <div>Shared workspace: {snapshot?.projectRoot ?? 'Not loaded'}</div>
            {snapshot?.sidecar.lastError && <div style={{ color: 'var(--red)' }}>{snapshot.sidecar.lastError}</div>}
          </div>
        </section>

        <section style={panelStyle}>
          <div className="panel-header">
            <h3>Bindings</h3>
            <span>{boundMembers}/{team.members.length} bound</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {team.members.map((member) => (
              <div key={member.id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                <div style={{ fontSize: '11px', color: 'var(--text-primary)', marginBottom: '4px' }}>
                  {member.role}
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                  {member.runtimeProfileRef ?? 'Missing runtimeProfileRef'}
                </div>
                {(member.runtimeHint?.provider || member.runtimeHint?.model) && (
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '4px' }}>
                    Hint: {member.runtimeHint?.provider ?? 'provider'} / {member.runtimeHint?.model ?? 'model'}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>

        <CommandApprovalsPanel
          approvals={approvals}
          tasks={teamTasks}
          selectedTaskId={null}
          busyApprovalId={busyApprovalId}
          error={approvalError}
          onApprove={(approvalId) => {
            void handleApprovalAction(approvalId, 'approve');
          }}
          onDeny={(approvalId) => {
            void handleApprovalAction(approvalId, 'deny');
          }}
        />
      </div>
    </div>
  );
}

function resolveMemberStatus(
  member: TeamMemberConfig,
  status?: AgentStatus,
): AgentStatus {
  if (status) {
    return status;
  }

  return {
    agentId: member.id,
    role: member.role,
    model: member.runtimeHint?.model ?? 'Not connected',
    provider: member.runtimeHint?.provider ?? 'nemoclaw',
    backend: 'nemoclaw',
    status: member.runtimeProfileRef ? 'idle' : 'unavailable',
    hasCredentials: Boolean(member.runtimeProfileRef),
  };
}

function Metric({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div>
      <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-muted)', marginBottom: '2px' }}>
        {label}
      </div>
      <div style={{ fontSize: '14px', color: 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}

function trimText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: '9px',
  textTransform: 'uppercase',
  letterSpacing: '2px',
  color: 'var(--text-muted)',
  marginBottom: '8px',
};

const panelStyle: React.CSSProperties = {
  background: 'var(--bg-panel)',
  border: 'var(--border-width) solid var(--border)',
  padding: '14px',
  boxSizing: 'border-box',
};

const metricsGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
  gap: '12px',
};

const copyStyle: React.CSSProperties = {
  fontSize: '11px',
  color: 'var(--text-secondary)',
  marginBottom: '12px',
};

const emptyStateStyle: React.CSSProperties = {
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--bg-base)',
  color: 'var(--text-muted)',
  fontSize: '12px',
};

function chipStyle(color: string): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px 8px',
    border: `1px solid ${color}`,
    color,
    fontSize: '10px',
    textTransform: 'uppercase',
    letterSpacing: '0.8px',
    background: 'transparent',
  };
}
