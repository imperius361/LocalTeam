import React, { useEffect, useState } from 'react';

import { useNav } from '../../navigation/NavContext';
import { useAppStore } from '../../store/appStore';
import { loadProjectSnapshot, pickProjectFolder } from '../../lib/ipc';
import { formatWorkspaceError, loadAndStoreWorkspace } from '../../lib/workspace';
import { ProgressBar } from '../common/ProgressBar';
import type { RecentProject } from '../../lib/contracts';

export function GlobalView(): React.ReactElement {
  const { navigate } = useNav();
  const snapshot = useAppStore((s) => s.snapshot);
  const recentProjects = useAppStore((s) => s.recentProjects);
  const loadRecents = useAppStore((s) => s.loadRecents);
  const setSnapshot = useAppStore((s) => s.setSnapshot);
  const addRecentProject = useAppStore((s) => s.addRecentProject);
  const setActiveProjectPath = useAppStore((s) => s.setActiveProjectPath);
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  const [loadingProjectPath, setLoadingProjectPath] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    loadRecents();
  }, [loadRecents]);

  const teams = snapshot?.config?.teams ?? [];
  const members = teams.flatMap((team) => team.members);
  const session = snapshot?.session ?? null;
  const pendingApprovals = (snapshot?.commandApprovals ?? []).filter(
    (approval) => approval.status === 'pending',
  );
  const activeStatuses = snapshot?.agentStatuses ?? [];
  const connectedMembers = activeStatuses.filter((status) => status.status !== 'unavailable').length;
  const activeMembers = activeStatuses.filter(
    (status) => status.status === 'thinking' || status.status === 'writing',
  ).length;
  const sidecarReady = snapshot?.sidecar?.ready ?? false;
  const hasSession = Boolean(session && session.status !== 'idle');
  const alertMembers = activeStatuses.filter(
    (status) => status.status === 'unavailable' || Boolean(status.lastError),
  );
  const hasAlerts =
    alertMembers.length > 0 || pendingApprovals.length > 0 || Boolean(snapshot?.sidecar.lastError);

  async function loadAndActivateProject(rootPath: string): Promise<void> {
    setLoadingProjectPath(rootPath);
    setLoadError(null);

    try {
      const loadedSnapshot = await loadAndStoreWorkspace(rootPath, {
        loadProjectSnapshot,
        setSnapshot,
        addRecentProject,
        setActiveProjectPath,
      });

      if (loadedSnapshot.projectRoot) {
        navigate({ layer: 'project', projectPath: loadedSnapshot.projectRoot });
      }
    } catch (error) {
      setLoadError(formatWorkspaceError(error, 'Failed to open workspace.'));
    } finally {
      setLoadingProjectPath(null);
    }
  }

  async function openWorkspaceDialog(): Promise<void> {
    try {
      const selected = await pickProjectFolder(snapshot?.projectRoot ?? recentProjects[0]?.path);
      if (selected) {
        await loadAndActivateProject(selected);
      }
    } catch (error) {
      setLoadError(formatWorkspaceError(error, 'Failed to open workspace picker.'));
    }
  }

  async function openLegacyProjectDialog(): Promise<void> {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        filters: [{ name: 'LocalTeam Config', extensions: ['json'] }],
        title: 'Open LocalTeam Config',
      });
      if (typeof selected === 'string') {
        await loadAndActivateProject(selected);
      }
    } catch (error) {
      setLoadError(formatWorkspaceError(error, 'Failed to open legacy config.'));
    }
  }

  function getCardDotColor(project: RecentProject): string {
    if (!snapshot || snapshot.projectRoot !== project.path) {
      return '#6b7280';
    }
    if (!snapshot.sidecar.ready) {
      return 'var(--red)';
    }
    if (pendingApprovals.length > 0) {
      return 'var(--yellow)';
    }
    if (alertMembers.length > 0) {
      return 'var(--red)';
    }
    if (hasSession) {
      return 'var(--green)';
    }
    return '#6b7280';
  }

  function getCardMemberPips(project: RecentProject): { color: string; id: string }[] {
    if (!snapshot || snapshot.projectRoot !== project.path) {
      return [];
    }

    return snapshot.agentStatuses.map((status) => {
      let color = '#6b7280';
      if (status.status === 'unavailable') {
        color = 'var(--red)';
      } else if (status.status === 'thinking' || status.status === 'writing') {
        color = 'var(--yellow)';
      } else {
        color = 'var(--green)';
      }
      return { color, id: status.agentId };
    });
  }

  function getCardStats(project: RecentProject): {
    teams: number;
    members: number;
    approvals: number;
    sessions: number;
  } {
    if (!snapshot || snapshot.projectRoot !== project.path) {
      return { teams: 0, members: 0, approvals: 0, sessions: 0 };
    }

    return {
      teams: snapshot.config?.teams.length ?? 0,
      members: snapshot.config?.teams.flatMap((team) => team.members).length ?? 0,
      approvals: pendingApprovals.length,
      sessions: hasSession ? 1 : 0,
    };
  }

  const pageStyle: React.CSSProperties = {
    height: '100%',
    overflowY: 'auto',
    padding: '20px',
    background: 'var(--bg-base)',
    boxSizing: 'border-box',
  };

  const statRowStyle: React.CSSProperties = {
    display: 'flex',
    gap: '10px',
    marginBottom: '16px',
  };

  const statBoxStyle: React.CSSProperties = {
    flex: 1,
    background: 'var(--bg-panel)',
    border: 'var(--border-width) solid var(--border)',
    padding: '14px 16px',
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: '9px',
    textTransform: 'uppercase',
    letterSpacing: '1.5px',
    color: 'var(--text-muted)',
    marginBottom: '4px',
  };

  const subTextStyle: React.CSSProperties = {
    fontSize: '10px',
    color: 'var(--text-muted)',
    marginTop: '4px',
  };

  const sectionHeaderStyle: React.CSSProperties = {
    fontSize: '9px',
    textTransform: 'uppercase',
    letterSpacing: '2px',
    color: 'var(--text-muted)',
    marginBottom: '6px',
  };

  const hrStyle: React.CSSProperties = {
    border: 'none',
    borderTop: '1px solid var(--border)',
    margin: '0 0 14px 0',
  };

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '10px',
  };

  return (
    <div style={pageStyle} data-testid="global-view">
      <div style={statRowStyle}>
        <div style={statBoxStyle}>
          <div style={labelStyle}>Configured Teams</div>
          <div style={{ fontSize: '22px', fontWeight: 'bold', color: 'var(--accent)' }}>
            {teams.length}
          </div>
          <div style={subTextStyle}>
            {configLabel(teams.length, 'team')}
          </div>
        </div>

        <div style={statBoxStyle}>
          <div style={labelStyle}>Connected Members</div>
          <div style={{ fontSize: '22px', fontWeight: 'bold', color: 'var(--green)' }}>
            {connectedMembers}
          </div>
          <div style={subTextStyle}>{members.length} configured</div>
          <div style={{ marginTop: '6px' }}>
            <ProgressBar
              value={members.length > 0 ? (connectedMembers / members.length) * 100 : 0}
              color="var(--green)"
            />
          </div>
        </div>

        <div style={statBoxStyle}>
          <div style={labelStyle}>Active Members</div>
          <div style={{ fontSize: '22px', fontWeight: 'bold', color: 'var(--yellow)' }}>
            {activeMembers}
          </div>
          <div style={subTextStyle}>currently producing output</div>
        </div>

        <div style={statBoxStyle}>
          <div style={labelStyle}>Pending Approvals</div>
          <div style={{ fontSize: '22px', fontWeight: 'bold', color: 'var(--yellow)' }}>
            {pendingApprovals.length}
          </div>
          <div style={subTextStyle}>awaiting user review</div>
        </div>

        <div style={statBoxStyle}>
          <div style={labelStyle}>Gateway Bridge</div>
          <div
            style={{
              fontSize: '22px',
              fontWeight: 'bold',
              color: sidecarReady ? 'var(--green)' : 'var(--red)',
            }}
          >
            {sidecarReady ? 'Online' : 'Offline'}
          </div>
          <div style={subTextStyle}>
            {hasSession ? `Session ${session?.status ?? 'idle'}` : 'No active session'}
          </div>
        </div>
      </div>

      {hasAlerts && (
        <div
          data-testid="global-alerts"
          style={{
            background: pendingApprovals.length > 0 ? 'rgba(250,204,21,0.08)' : 'rgba(239,68,68,0.08)',
            border:
              pendingApprovals.length > 0
                ? '1px solid rgba(250,204,21,0.25)'
                : '1px solid rgba(239,68,68,0.25)',
            borderLeft:
              pendingApprovals.length > 0
                ? '3px solid var(--yellow)'
                : '3px solid var(--red)',
            padding: '8px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            marginBottom: '16px',
          }}
        >
          {pendingApprovals.length > 0 && (
            <div style={{ fontSize: '11px' }}>
              {pendingApprovals.length} command approval
              {pendingApprovals.length === 1 ? '' : 's'} need review before Nemoclaw can continue.
            </div>
          )}
          {alertMembers.map((agent) => (
            <div
              key={agent.agentId}
              style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11px' }}
            >
              <span>{agent.role} is unavailable</span>
              {agent.lastError && <span style={{ color: 'var(--text-muted)' }}>{agent.lastError}</span>}
            </div>
          ))}
          {snapshot?.sidecar.lastError && (
            <div style={{ fontSize: '11px' }}>{snapshot.sidecar.lastError}</div>
          )}
        </div>
      )}

      {loadError && (
        <div style={{ marginBottom: '12px', color: 'var(--red)', fontSize: '11px' }}>
          {loadError}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
        }}
      >
        <div>
          <div style={sectionHeaderStyle}>Projects</div>
          <hr style={hrStyle} />
        </div>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
          <button
            type="button"
            data-testid="global-open-workspace"
            onClick={() => {
              void openWorkspaceDialog();
            }}
            style={actionButtonStyle(false)}
          >
            Open Workspace
          </button>
          <button
            type="button"
            data-testid="global-open-legacy-config"
            onClick={() => {
              void openLegacyProjectDialog();
            }}
            style={actionButtonStyle(true)}
          >
            Open Legacy Config
          </button>
        </div>
      </div>

      <div style={gridStyle}>
        {recentProjects.map((project) => {
          const dotColor = getCardDotColor(project);
          const pips = getCardMemberPips(project);
          const visiblePips = pips.slice(0, 6);
          const extraPips = pips.length - visiblePips.length;
          const stats = getCardStats(project);
          const isHovered = hoveredPath === project.path;

          return (
            <button
              type="button"
              data-testid={`recent-project-${project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
              key={project.path}
              style={{
                background: 'var(--bg-panel)',
                border: `var(--border-width) solid ${isHovered ? 'var(--accent)' : 'var(--border)'}`,
                padding: '16px',
                cursor: 'pointer',
                position: 'relative',
                boxSizing: 'border-box',
                transition: 'border-color 0.15s ease',
                textAlign: 'left',
                appearance: 'none',
              }}
              onMouseEnter={() => setHoveredPath(project.path)}
              onMouseLeave={() => setHoveredPath(null)}
              onClick={() => {
                if (!loadingProjectPath) {
                  void loadAndActivateProject(project.path);
                }
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                <div
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: dotColor,
                    flexShrink: 0,
                  }}
                />
                <strong style={{ fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {project.name}
                </strong>
              </div>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '10px' }}>
                {project.path}
              </div>
              <div style={{ display: 'flex', gap: '12px', fontSize: '11px', marginBottom: '10px' }}>
                <span>{stats.teams} teams</span>
                <span>{stats.members} members</span>
                <span>{stats.sessions} sessions</span>
                <span>{stats.approvals} approvals</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', minHeight: '12px' }}>
                {visiblePips.map((pip) => (
                  <div
                    key={pip.id}
                    style={{
                      width: '7px',
                      height: '7px',
                      borderRadius: '50%',
                      background: pip.color,
                    }}
                  />
                ))}
                {extraPips > 0 && (
                  <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                    +{extraPips}
                  </span>
                )}
              </div>
              {loadingProjectPath === project.path && (
                <div style={{ position: 'absolute', top: 12, right: 12, fontSize: '10px' }}>
                  Loading…
                </div>
              )}
            </button>
          );
        })}
      </div>

      {recentProjects.length === 0 && (
        <div style={{ marginTop: '18px', fontSize: '11px', color: 'var(--text-muted)' }}>
          No recent projects yet. Open a git workspace to create or load a team-managed project.
        </div>
      )}
    </div>
  );
}

function configLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'} configured`;
}

function actionButtonStyle(primary: boolean): React.CSSProperties {
  return {
    fontSize: '10px',
    color: primary ? 'var(--text-muted)' : 'var(--accent)',
    background: primary ? 'transparent' : 'var(--accent-dim)',
    border: primary ? '1px solid var(--border)' : '1px solid var(--accent)',
    padding: '6px 10px',
    cursor: 'pointer',
    textTransform: 'uppercase',
    letterSpacing: '1px',
  };
}
