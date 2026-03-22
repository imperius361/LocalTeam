import React, { useMemo, useState } from 'react';

import { useNav } from '../../navigation/NavContext';
import { resolveCommandApproval, restartSidecar } from '../../lib/ipc';
import { StatusBadge } from '../common/StatusBadge';
import { useAppStore } from '../../store/appStore';
import type { AgentStatus, TeamMemberConfig } from '../../lib/contracts';

function formatTime(ts: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(ts);
}

function initials(role: string): string {
  return role
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? '')
    .join('')
    .toUpperCase();
}

export function AgentView(): React.ReactElement {
  const { navState } = useNav();
  const snapshot = useAppStore((s) => s.snapshot);
  const teamMap = useAppStore((s) => s.teamMap);
  const agentStatusMap = useAppStore((s) => s.agentStatusMap);
  const messagesByAgent = useAppStore((s) => s.messagesByAgent);
  const approvalsByAgent = useAppStore((s) => s.approvalsByAgent);
  const patchSnapshot = useAppStore((s) => s.patchSnapshot);

  const teamId = navState.layer === 'agent' ? navState.teamId : '';
  const agentId = navState.layer === 'agent' ? navState.agentId : '';
  const team = teamMap[teamId] ?? snapshot?.config?.teams.find((entry) => entry.id === teamId) ?? null;
  const member = team?.members.find((entry) => entry.id === agentId) ?? null;
  const status = resolveMemberStatus(member, agentStatusMap[agentId]);
  const messages = useMemo(
    () => [...(messagesByAgent[agentId] ?? [])].sort((left, right) => right.timestamp - left.timestamp),
    [agentId, messagesByAgent],
  );
  const approvals = approvalsByAgent[agentId] ?? [];
  const pendingApprovals = approvals.filter((approval) => approval.status === 'pending');
  const settledApprovals = approvals.filter((approval) => approval.status !== 'pending');
  const [busyApprovalId, setBusyApprovalId] = useState<string | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);

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

  if (!member) {
    return <div style={emptyStateStyle}>Team member not found: {agentId}</div>;
  }

  return (
    <div
      data-testid="agent-view"
      style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-base)' }}
    >
      <div
        style={{
          flexShrink: 0,
          background: 'var(--bg-panel)',
          borderBottom: 'var(--border-width) solid var(--border)',
          padding: '14px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: 14,
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            background: 'var(--accent-dim)',
            border: '1px solid var(--accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--accent)',
            flexShrink: 0,
          }}
        >
          {initials(member.role)}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{member.role}</div>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-muted)', marginTop: 2 }}>
            {status.provider} · {status.model} · {status.backend}
          </div>
        </div>
        <StatusBadge status={status.status} />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            type="button"
            data-testid="agent-restart-bridge"
            style={buttonStyle}
            onClick={() => restartSidecar().catch(console.error)}
          >
            Restart Bridge
          </button>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            Session-owned runtime
          </span>
        </div>
      </div>

      <div style={{ flexShrink: 0, display: 'flex', borderBottom: 'var(--border-width) solid var(--border)' }}>
        <Stat label="Runtime Ref" value={member.runtimeProfileRef ?? 'Missing'} />
        <Stat label="Pending Approvals" value={String(pendingApprovals.length)} />
        <Stat label="Messages" value={String(messages.length)} />
        <Stat label="Commands" value={String(approvals.length)} />
        <Stat label="Session" value={snapshot?.session?.status ?? 'Not started'} />
      </div>

      {snapshot?.sidecar.lastError ? (
        <div
          data-testid="agent-sidecar-error"
          style={{
            padding: '10px 16px',
            borderBottom: '1px solid var(--border)',
            color: 'var(--red)',
            fontSize: '11px',
            background: 'rgba(239,68,68,0.08)',
          }}
        >
          {snapshot.sidecar.lastError}
        </div>
      ) : snapshot?.sidecar.ready ? (
        <div
          style={{
            padding: '10px 16px',
            borderBottom: '1px solid var(--border)',
            fontSize: '11px',
            color: 'var(--text-muted)',
          }}
        >
          Bridge is healthy and streaming activity.
        </div>
      ) : null}

      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
        <div
          style={{
            width: 320,
            flexShrink: 0,
            borderRight: '1px solid var(--border)',
            overflowY: 'auto',
            padding: '14px',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          <section style={panelStyle}>
            <div className="panel-header">
              <h3>Member Policy</h3>
              <span>{team?.name ?? 'Unknown team'}</span>
            </div>
            <div style={stackStyle}>
              <Metadata label="Role" value={member.role} />
              <Metadata label="Runtime profile" value={member.runtimeProfileRef ?? 'Not bound'} />
              <Metadata
                label="Runtime hint"
                value={
                  member.runtimeHint?.provider || member.runtimeHint?.model
                    ? `${member.runtimeHint?.provider ?? 'provider'} / ${member.runtimeHint?.model ?? 'model'}`
                    : 'None'
                }
              />
              <Metadata label="Commands" value={member.canExecuteCommands ? 'Enabled' : 'Disabled'} />
              <Metadata
                label="Allowed paths"
                value={
                  member.allowedPaths && member.allowedPaths.length > 0
                    ? member.allowedPaths.join(', ')
                    : 'Project defaults'
                }
              />
              <Metadata
                label="Pre-approved commands"
                value={
                  member.preApprovedCommands && member.preApprovedCommands.length > 0
                    ? member.preApprovedCommands.join(', ')
                    : 'None'
                }
              />
            </div>
          </section>

          <section style={panelStyle}>
            <div className="panel-header">
              <h3>System Prompt</h3>
              <span>{member.systemPrompt.length} chars</span>
            </div>
            <pre
              style={{
                margin: 0,
                whiteSpace: 'pre-wrap',
                fontFamily: 'var(--font-sans)',
                fontSize: '11px',
                color: 'var(--text-secondary)',
              }}
            >
              {member.systemPrompt}
            </pre>
          </section>
        </div>

        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              flexShrink: 0,
              padding: '8px 12px',
              borderBottom: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span style={sectionHeaderStyle}>Session Activity</span>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
              {messages.length} messages
            </span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {messages.length === 0 ? (
              <div style={{ padding: '12px 16px', fontSize: '11px', color: 'var(--text-muted)' }}>
                No activity recorded for this member yet.
              </div>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  style={{
                    display: 'flex',
                    gap: 10,
                    padding: '8px 16px',
                    fontSize: 12,
                    lineHeight: 1.5,
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <span
                    style={{
                      width: 68,
                      flexShrink: 0,
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      color: 'var(--text-muted)',
                    }}
                  >
                    {formatTime(message.timestamp)}
                  </span>
                  <span
                    style={{
                      width: 92,
                      flexShrink: 0,
                      fontSize: 9,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {message.type}
                  </span>
                  <span style={{ flex: 1, color: 'var(--text-secondary)', minWidth: 0, wordBreak: 'break-word' }}>
                    {message.content}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div
          style={{
            width: 340,
            flexShrink: 0,
            borderLeft: '1px solid var(--border)',
            overflowY: 'auto',
            padding: '14px',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            gap: '14px',
          }}
        >
          <section style={panelStyle}>
            <div className="panel-header">
              <h3>Approvals</h3>
              <span>{pendingApprovals.length} pending</span>
            </div>
            {approvalError && <p className="recovery-copy settings-error">{approvalError}</p>}
            {pendingApprovals.length === 0 ? (
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                No pending approvals for this member.
              </div>
            ) : (
              pendingApprovals.map((approval) => (
                <article key={approval.id} className="approval-card approval-pending">
                  <header>
                    <div>
                      <strong>{approval.command}</strong>
                      <p>{approval.policy.sandboxMode} sandbox</p>
                    </div>
                    <span>{approval.status}</span>
                  </header>
                  <div className="approval-meta">
                    <span>{approval.effectiveCwd}</span>
                    {approval.reason && <span>{approval.reason}</span>}
                  </div>
                  <div className="approval-actions">
                    <button
                      className="primary-button"
                      type="button"
                      data-testid={`agent-approval-approve-${approval.id}`}
                      disabled={busyApprovalId === approval.id}
                      onClick={() => {
                        void handleApprovalAction(approval.id, 'approve');
                      }}
                    >
                      Approve
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      data-testid={`agent-approval-deny-${approval.id}`}
                      disabled={busyApprovalId === approval.id}
                      onClick={() => {
                        void handleApprovalAction(approval.id, 'deny');
                      }}
                    >
                      Deny
                    </button>
                  </div>
                </article>
              ))
            )}
          </section>

          <section style={panelStyle}>
            <div className="panel-header">
              <h3>Approval History</h3>
              <span>{settledApprovals.length} settled</span>
            </div>
            {settledApprovals.length === 0 ? (
              <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                No completed approvals for this member yet.
              </div>
            ) : (
              settledApprovals.map((approval) => (
                <div key={approval.id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: '8px', marginBottom: '8px' }}>
                  <div style={{ fontSize: '11px', color: 'var(--text-primary)', marginBottom: '4px' }}>
                    {approval.command}
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                    {approval.status}
                    {approval.exitCode !== undefined ? ` • exit ${approval.exitCode}` : ''}
                  </div>
                </div>
              ))
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function resolveMemberStatus(
  member: TeamMemberConfig | null,
  status?: AgentStatus,
): AgentStatus {
  if (status) {
    return status;
  }

  return {
    agentId: member?.id ?? 'unknown',
    role: member?.role ?? 'Unknown member',
    model: member?.runtimeHint?.model ?? 'Not connected',
    provider: member?.runtimeHint?.provider ?? 'nemoclaw',
    backend: 'nemoclaw',
    status: member?.runtimeProfileRef ? 'idle' : 'unavailable',
    hasCredentials: Boolean(member?.runtimeProfileRef),
  };
}

function Stat({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div
      style={{
        flex: 1,
        padding: '10px 14px',
        borderRight: '1px solid var(--border)',
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-muted)', marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}

function Metadata({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div>
      <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-muted)', marginBottom: '2px' }}>
        {label}
      </div>
      <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{value}</div>
    </div>
  );
}

const buttonStyle: React.CSSProperties = {
  background: 'var(--bg-raised)',
  border: 'var(--border-width) solid var(--border)',
  color: 'var(--text-secondary)',
  padding: '4px 12px',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const panelStyle: React.CSSProperties = {
  background: 'var(--bg-panel)',
  border: 'var(--border-width) solid var(--border)',
  padding: '14px',
  boxSizing: 'border-box',
};

const stackStyle: React.CSSProperties = {
  display: 'grid',
  gap: '10px',
};

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: 9,
  textTransform: 'uppercase',
  letterSpacing: '2px',
  color: 'var(--text-muted)',
};

const emptyStateStyle: React.CSSProperties = {
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--bg-base)',
  color: 'var(--text-muted)',
  fontSize: 12,
};
