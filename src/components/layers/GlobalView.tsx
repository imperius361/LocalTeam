import React, { useEffect, useState } from 'react';
import { useNav } from '../../navigation/NavContext';
import { useAppStore } from '../../store/appStore';
import { loadProjectSnapshot, pickProjectFolder } from '../../lib/ipc';
import { formatWorkspaceError, loadAndStoreWorkspace } from '../../lib/workspace';
import { countActiveRequestTasks } from '../../lib/taskSelectors';
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

  const agentStatuses = snapshot?.agentStatuses ?? [];
  const tasks = snapshot?.tasks ?? [];

  const activeAgents = agentStatuses.filter(
    (a) => a.status !== 'idle' && a.status !== 'unavailable',
  ).length;
  const totalAgents = agentStatuses.length;
  const runningTasks = countActiveRequestTasks(tasks);
  const sidecarReady = snapshot?.sidecar?.ready ?? false;

  const alertAgents = agentStatuses.filter(
    (a) => a.status === 'unavailable' || !!a.lastError,
  );
  const hasAlerts = alertAgents.length > 0;

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

  async function openWorkspaceDialog() {
    try {
      const selected = await pickProjectFolder(snapshot?.projectRoot ?? recentProjects[0]?.path);
      if (selected) {
        await loadAndActivateProject(selected);
      }
    } catch (error) {
      setLoadError(formatWorkspaceError(error, 'Failed to open workspace picker.'));
    }
  }

  async function openLegacyProjectDialog() {
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

  const openActionStyle: React.CSSProperties = {
    fontSize: '10px',
    color: 'var(--text-muted)',
    background: 'transparent',
    border: '1px solid var(--border)',
    padding: '4px 8px',
    cursor: loadingProjectPath ? 'not-allowed' : 'pointer',
  };

  function getCardDotColor(project: RecentProject): string {
    if (!snapshot || snapshot.projectRoot !== project.path) return '#6b7280';
    const statuses = snapshot.agentStatuses;
    if (statuses.some((a) => a.status === 'unavailable')) return 'var(--red)';
    if (statuses.some((a) => a.status !== 'idle' && a.status !== 'unavailable')) return 'var(--yellow)';
    if (statuses.length > 0) return 'var(--green)';
    return '#6b7280';
  }

  function getCardAgentPips(project: RecentProject): { color: string; id: string }[] {
    if (!snapshot || snapshot.projectRoot !== project.path) return [];
    return snapshot.agentStatuses.map((a) => {
      let color = '#6b7280';
      if (a.status === 'unavailable') color = 'var(--red)';
      else if (a.status !== 'idle') color = 'var(--yellow)';
      else color = 'var(--green)';
      return { color, id: a.agentId };
    });
  }

  function getCardStats(project: RecentProject): { teams: number; agents: number; running: number } {
    if (!snapshot || snapshot.projectRoot !== project.path) {
      return { teams: 0, agents: 0, running: 0 };
    }
    const teams = snapshot.config?.team ? 1 : 0;
    const agents = snapshot.agentStatuses.length;
    const running = countActiveRequestTasks(snapshot.tasks);
    return { teams, agents, running };
  }

  return (
    <div style={pageStyle}>
      {/* Section 1: System Metrics */}
      <div style={statRowStyle}>
        {/* Active Agents */}
        <div style={statBoxStyle}>
          <div style={labelStyle}>Active Agents</div>
          <div style={{ fontSize: '22px', fontWeight: 'bold', color: 'var(--green)' }}>
            {activeAgents}
          </div>
          <div style={subTextStyle}>{totalAgents} total</div>
          <div style={{ marginTop: '6px' }}>
            <ProgressBar
              value={totalAgents > 0 ? (activeAgents / totalAgents) * 100 : 0}
              color="var(--green)"
            />
          </div>
        </div>

        {/* Running Tasks */}
        <div style={statBoxStyle}>
          <div style={labelStyle}>Running Tasks</div>
          <div style={{ fontSize: '22px', fontWeight: 'bold', color: 'var(--yellow)' }}>
            {runningTasks}
          </div>
          <div style={subTextStyle}>in progress</div>
        </div>

        {/* CPU */}
        <div style={statBoxStyle}>
          <div style={labelStyle}>CPU</div>
          <div style={{ fontSize: '22px', fontWeight: 'bold' }}>--</div>
          <div style={subTextStyle}>live metrics coming soon</div>
        </div>

        {/* Memory */}
        <div style={statBoxStyle}>
          <div style={labelStyle}>Memory</div>
          <div style={{ fontSize: '22px', fontWeight: 'bold' }}>--</div>
          <div style={subTextStyle}>live metrics coming soon</div>
        </div>

        {/* Sidecar */}
        <div style={statBoxStyle}>
          <div style={labelStyle}>Sidecar</div>
          <div
            style={{
              fontSize: '22px',
              fontWeight: 'bold',
              color: sidecarReady ? 'var(--green)' : 'var(--red)',
            }}
          >
            {sidecarReady ? 'Online' : 'Offline'}
          </div>
          <div style={subTextStyle}>{sidecarReady ? 'connected' : 'not connected'}</div>
        </div>
      </div>

      {/* Section 2: Alert strip */}
      {hasAlerts && (
        <div
          style={{
            background: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.25)',
            borderLeft: '3px solid var(--red)',
            padding: '8px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            marginBottom: '16px',
          }}
        >
          {alertAgents.map((a) => (
            <div
              key={a.agentId}
              style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11px' }}
            >
              <span>⚠ {a.role} is blocked</span>
              <button
                onClick={() => {}}
                style={{
                  fontSize: '10px',
                  padding: '2px 8px',
                  background: 'transparent',
                  border: '1px solid rgba(239,68,68,0.4)',
                  color: 'var(--red)',
                  cursor: 'pointer',
                }}
              >
                Resolve
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Section 3: Section header */}
      <div style={sectionHeaderStyle}>Projects</div>
      <hr style={hrStyle} />

      {/* Section 4: Project grid */}
      <div style={gridStyle}>
        {recentProjects.map((project) => {
          const dotColor = getCardDotColor(project);
          const pips = getCardAgentPips(project);
          const visiblePips = pips.slice(0, 5);
          const extraPips = pips.length - visiblePips.length;
          const stats = getCardStats(project);
          const isHovered = hoveredPath === project.path;

          const cardStyle: React.CSSProperties = {
            background: 'var(--bg-panel)',
            border: `var(--border-width) solid ${isHovered ? 'var(--accent)' : 'var(--border)'}`,
            padding: '16px',
            cursor: 'pointer',
            position: 'relative',
            boxSizing: 'border-box',
            transition: 'border-color 0.15s ease',
          };

          return (
            <div
              key={project.path}
              style={cardStyle}
              onMouseEnter={() => setHoveredPath(project.path)}
              onMouseLeave={() => setHoveredPath(null)}
              onClick={() => {
                if (!loadingProjectPath) {
                  void loadAndActivateProject(project.path);
                }
              }}
            >
              {/* Status dot + name */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <div
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: dotColor,
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: '13px', fontWeight: 600 }}>{project.name}</span>
              </div>

              {/* Project path */}
              <div
                style={{
                  fontSize: '10px',
                  fontFamily: 'monospace',
                  color: 'var(--text-muted)',
                  marginBottom: '10px',
                  wordBreak: 'break-all',
                }}
              >
                {project.path}
              </div>

              {/* Stats row */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '4px',
                  marginBottom: '10px',
                }}
              >
                {[
                  { label: 'Teams', value: stats.teams },
                  { label: 'Agents', value: stats.agents },
                  { label: 'Running', value: stats.running },
                ].map((cell) => (
                  <div key={cell.label} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: '12px', fontWeight: 600 }}>{cell.value}</div>
                    <div style={{ fontSize: '9px', color: 'var(--text-muted)' }}>{cell.label}</div>
                  </div>
                ))}
              </div>

              {/* Agent pip row */}
              {visiblePips.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {visiblePips.map((pip) => (
                    <div
                      key={pip.id}
                      style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        background: pip.color,
                      }}
                    />
                  ))}
                  {extraPips > 0 && (
                    <span style={{ fontSize: '9px', color: 'var(--text-muted)' }}>
                      +{extraPips} more
                    </span>
                  )}
                </div>
              )}

              {/* Hover hint */}
              <div
                style={{
                  position: 'absolute',
                  bottom: '10px',
                  right: '12px',
                  fontSize: '9px',
                  color: 'var(--accent)',
                  opacity: isHovered ? 1 : 0,
                  transition: 'opacity 0.15s ease',
                  pointerEvents: 'none',
                }}
              >
                Open →
              </div>
            </div>
          );
        })}

        {/* Add project card */}
        <div
          style={{
            background: 'var(--bg-panel)',
            border: `var(--border-width) dashed var(--border)`,
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            minHeight: '100px',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ fontSize: '20px', color: 'var(--text-muted)' }}>+</div>
          <div style={{ fontSize: '12px', fontWeight: 600 }}>Open Workspace</div>
          <div style={{ fontSize: '10px', color: 'var(--text-muted)', textAlign: 'center' }}>
            Choose the git repository folder LocalTeam should operate against
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
            <button
              type="button"
              style={openActionStyle}
              onClick={() => {
                void openWorkspaceDialog();
              }}
              disabled={Boolean(loadingProjectPath)}
            >
              {loadingProjectPath ? 'Opening…' : 'Choose Folder'}
            </button>
            <button
              type="button"
              style={openActionStyle}
              onClick={() => {
                void openLegacyProjectDialog();
              }}
              disabled={Boolean(loadingProjectPath)}
            >
              Use localteam.json
            </button>
          </div>
        </div>
      </div>

      {loadError && (
        <div
          style={{
            marginTop: '12px',
            fontSize: '11px',
            color: 'var(--red)',
          }}
        >
          {loadError}
        </div>
      )}
    </div>
  );
}
