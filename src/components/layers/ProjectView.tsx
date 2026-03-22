import React from 'react';

import { useNav } from '../../navigation/NavContext';
import { useAppStore } from '../../store/appStore';

function formatTime(ts: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(ts);
}

export function ProjectView(): React.ReactElement {
  const { navState, navigate } = useNav();
  const snapshot = useAppStore((s) => s.snapshot);
  const teamMap = useAppStore((s) => s.teamMap);

  const projectPath = navState.layer === 'project' ? navState.projectPath : '';
  const config = snapshot?.config ?? null;
  const teams = config?.teams ?? [];
  const session = snapshot?.session ?? null;
  const approvals = snapshot?.commandApprovals ?? [];
  const pendingApprovals = approvals.filter((approval) => approval.status === 'pending');
  const recentMessages = [...(snapshot?.messages ?? [])]
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, 16);
  const defaultTeamId = config?.defaultTeamId ?? null;

  const sectionHeaderStyle: React.CSSProperties = {
    fontSize: '9px',
    textTransform: 'uppercase',
    letterSpacing: '2px',
    color: 'var(--text-muted)',
    marginBottom: '8px',
  };

  return (
    <div
      data-testid="project-view"
      style={{
        display: 'flex',
        gap: '16px',
        padding: '16px',
        height: '100%',
        background: 'var(--bg-base)',
        boxSizing: 'border-box',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          flex: 1.25,
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          overflowY: 'auto',
          minWidth: 0,
        }}
      >
        <section>
          <div style={sectionHeaderStyle}>Project Teams</div>
          {teams.length === 0 ? (
            <div style={emptyStateStyle}>No teams are configured for this project yet.</div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
                gap: '12px',
              }}
            >
              {teams.map((team) => {
                const statuses = team.members
                  .map((member) => snapshot?.agentStatuses.find((status) => status.agentId === member.id))
                  .filter((status): status is NonNullable<typeof status> => Boolean(status));
                const boundMembers = team.members.filter((member) => member.runtimeProfileRef).length;
                const memberActivity = recentMessages.filter((message) =>
                  team.members.some((member) => member.id === message.agentId),
                );
                const isDefault = defaultTeamId === team.id;
                const isSessionTarget =
                  session?.teamId === team.id || (!session?.teamId && teams.length === 1);

                return (
                  <button
                    key={team.id}
                    type="button"
                    data-testid={`project-team-${team.id}`}
                    onClick={() => navigate({ layer: 'team', projectPath, teamId: team.id })}
                    style={{
                      textAlign: 'left',
                      background: 'var(--bg-panel)',
                      border: 'var(--border-width) solid var(--border)',
                      padding: '14px',
                      cursor: 'pointer',
                      boxSizing: 'border-box',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '10px',
                        marginBottom: '8px',
                      }}
                    >
                      <strong style={{ fontSize: '14px' }}>{team.name}</strong>
                      <span style={chipStyle(isSessionTarget ? 'var(--green)' : 'var(--text-muted)')}>
                        {isSessionTarget ? 'Session target' : isDefault ? 'Default team' : 'Configured'}
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                      <span>{team.members.length} members</span>
                      <span>{boundMembers} bound</span>
                      <span>{statuses.filter((status) => status.status !== 'unavailable').length} connected</span>
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                      {team.members.map((member) => {
                        const status = snapshot?.agentStatuses.find((entry) => entry.agentId === member.id);
                        return (
                          <span
                            key={member.id}
                            style={chipStyle(
                              status?.status === 'unavailable'
                                ? 'var(--red)'
                                : member.runtimeProfileRef
                                  ? 'var(--accent)'
                                  : 'var(--text-muted)',
                            )}
                          >
                            {member.role}
                          </span>
                        );
                      })}
                    </div>

                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      {memberActivity[0]
                        ? `${memberActivity[0].agentRole} • ${trimText(memberActivity[0].content, 90)}`
                        : 'No recent team activity yet.'}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <div style={sectionHeaderStyle}>Project Runtime Policy</div>
          <div style={panelStyle}>
            <div style={summaryGridStyle}>
              <Metric label="Workspace mode" value={teams[0]?.workspaceMode ?? 'shared_project'} />
              <Metric label="Default team" value={teamMap[defaultTeamId ?? '']?.name ?? teams[0]?.name ?? 'None'} />
              <Metric label="Sandbox" value={config?.sandbox.defaultMode ?? 'direct'} />
              <Metric label="Denied paths" value={String(config?.fileAccess.denyList.length ?? 0)} />
            </div>
          </div>
        </section>
      </div>

      <div
        style={{
          width: '320px',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          overflow: 'hidden',
        }}
      >
        <section style={panelStyle}>
          <div className="panel-header">
            <h3>Gateway Health</h3>
            <span>{snapshot?.sidecar.ready ? 'Online' : 'Offline'}</span>
          </div>
          <div style={{ display: 'grid', gap: '8px', fontSize: '11px', color: 'var(--text-secondary)' }}>
            <div>Project path: {projectPath || 'Not loaded'}</div>
            <div>Session: {session ? session.status : 'Not started'}</div>
            <div>Pending approvals: {pendingApprovals.length}</div>
            <div>Live members: {snapshot?.agentStatuses.length ?? 0}</div>
            {snapshot?.sidecar.lastError && (
              <div style={{ color: 'var(--red)' }}>{snapshot.sidecar.lastError}</div>
            )}
          </div>
        </section>

        <section style={{ ...panelStyle, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div className="panel-header">
            <h3>Recent Activity</h3>
            <span>{recentMessages.length} entries</span>
          </div>
          <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {recentMessages.length === 0 ? (
              <div style={emptyStateStyle}>No runtime activity has been recorded for this project yet.</div>
            ) : (
              recentMessages.map((message) => (
                <div key={message.id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: '8px' }}>
                  <div style={{ display: 'flex', gap: '6px', marginBottom: '4px', fontSize: '10px', color: 'var(--text-muted)' }}>
                    <span>{formatTime(message.timestamp)}</span>
                    <span>{message.agentRole}</span>
                    <span>{message.type}</span>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                    {trimText(message.content, 120)}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div>
      <div style={{ fontSize: '9px', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-muted)', marginBottom: '2px' }}>
        {label}
      </div>
      <div style={{ fontSize: '12px', color: 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}

function trimText(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

const panelStyle: React.CSSProperties = {
  background: 'var(--bg-panel)',
  border: 'var(--border-width) solid var(--border)',
  padding: '14px',
  boxSizing: 'border-box',
};

const summaryGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '12px',
};

const emptyStateStyle: React.CSSProperties = {
  fontSize: '11px',
  color: 'var(--text-muted)',
};

function chipStyle(color: string): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '2px 8px',
    border: `1px solid ${color}`,
    color,
    fontSize: '10px',
    textTransform: 'uppercase',
    letterSpacing: '0.8px',
    background: 'transparent',
  };
}
