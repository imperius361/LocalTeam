import React from 'react';
import { useNav } from '../navigation/NavContext';
import { useAppStore } from '../store/appStore';
import { StatusBadge } from './common/StatusBadge';
import { useTheme } from '../themes/ThemeContext';
import type { AgentStatus } from '../lib/contracts';

type AgentRunStatus = AgentStatus['status'];

function getTeamDotColor(agents: AgentStatus[]): string {
  if (agents.some((a) => a.status === 'unavailable')) {
    return 'var(--red, #f87171)';
  }
  if (agents.some((a) => a.status === 'thinking' || a.status === 'writing' || a.status === 'waiting_for_consensus')) {
    return 'var(--yellow, #facc15)';
  }
  if (agents.some((a) => a.status !== 'idle')) {
    return 'var(--green, #4ade80)';
  }
  return 'var(--green, #4ade80)';
}

export function Sidebar(): React.ReactElement {
  const { navState, navigate } = useNav();
  const snapshot = useAppStore((s) => s.snapshot);
  const { theme } = useTheme();

  const isPixel = theme === 'pixel';

  const containerStyle: React.CSSProperties = {
    width: 190,
    background: 'var(--bg-panel)',
    borderRight: 'var(--border-width) solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    boxSizing: 'border-box',
    overflow: 'hidden',
  };

  const sectionHeaderStyle: React.CSSProperties = {
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 2,
    color: 'var(--text-muted)',
    borderBottom: '1px solid var(--border-soft)',
    padding: '8px 10px 6px',
    fontFamily: isPixel ? "'Press Start 2P', monospace" : undefined,
  };

  const teams = snapshot?.config?.teams ?? [];
  const agentStatuses = snapshot?.agentStatuses ?? [];

  // Determine projectPath and teamId from navState when not global
  const projectPath =
    navState.layer !== 'global' ? navState.projectPath : '';
  const currentTeamId =
    navState.layer === 'team' || navState.layer === 'agent'
      ? navState.teamId
      : snapshot?.activeTeamId ?? snapshot?.config?.defaultTeamId ?? teams[0]?.id;
  const currentAgentId =
    navState.layer === 'agent' ? navState.agentId : undefined;
  const selectedTeam = currentTeamId
    ? teams.find((entry) => entry.id === currentTeamId)
    : teams[0];

  const isTeamActive =
    navState.layer === 'team' || navState.layer === 'agent';

  const sidecarReady = snapshot?.sidecar?.ready ?? false;

  function handleTeamClick(teamId: string) {
    if (!projectPath) return;
    navigate({ layer: 'team', projectPath, teamId });
  }

  function handleAgentClick(agentId: string, teamId: string) {
    if (!projectPath) return;
    navigate({
      layer: 'agent',
      projectPath,
      teamId,
      agentId,
    });
  }

  const teamDotStyle: React.CSSProperties = {
    width: 6,
    height: 6,
    borderRadius: isPixel ? 0 : '50%',
    backgroundColor: 'var(--text-muted)',
    flexShrink: 0,
  };

  const rowBaseStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    padding: '5px 10px',
    cursor: 'pointer',
    fontSize: 11,
    color: 'var(--text-secondary)',
    boxSizing: 'border-box',
  };

  const activeRowStyle: React.CSSProperties = {
    ...rowBaseStyle,
    borderLeft: 'var(--border-width) solid var(--accent)',
    background: 'var(--bg-raised)',
    color: 'var(--text-primary)',
  };

  const footerStyle: React.CSSProperties = {
    marginTop: 'auto',
    padding: '8px 10px',
    borderTop: '1px solid var(--border-soft)',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    fontSize: 10,
    color: 'var(--text-muted)',
  };

  const sidecarDotStyle: React.CSSProperties = {
    width: 6,
    height: 6,
    borderRadius: isPixel ? 0 : '50%',
    backgroundColor: sidecarReady ? 'var(--green, #4ade80)' : 'var(--red, #f87171)',
    flexShrink: 0,
  };

  return (
    <div style={containerStyle}>
      {/* Teams section */}
      <div className="sidebar-section-title" style={sectionHeaderStyle}>Teams</div>

      {teams.map((team) => {
        const teamStatuses = team.members
          .map((member) => agentStatuses.find((status) => status.agentId === member.id))
          .filter((status): status is AgentStatus => Boolean(status));
        const isActiveTeam = isTeamActive && currentTeamId === team.id;

        return (
          <div
            key={team.id}
            style={isActiveTeam ? activeRowStyle : rowBaseStyle}
            onClick={() => handleTeamClick(team.id)}
          >
            <div
              style={{
                ...teamDotStyle,
                backgroundColor:
                  teamStatuses.length > 0
                    ? getTeamDotColor(teamStatuses)
                    : 'var(--text-muted)',
              }}
            />
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontFamily: isPixel ? "'Press Start 2P', monospace" : undefined,
              }}
            >
              {team.name}
            </span>
          </div>
        );
      })}

      {/* Agents section */}
      <div className="sidebar-section-title" style={{ ...sectionHeaderStyle, marginTop: 8 }}>Agents</div>

      {(selectedTeam?.members ?? []).map((member) => {
        const agent =
          agentStatuses.find((status) => status.agentId === member.id) ??
          {
            agentId: member.id,
            role: member.role,
            model: member.runtimeHint?.model ?? 'Not connected',
            provider: member.runtimeHint?.provider ?? 'nemoclaw',
            backend: 'nemoclaw' as const,
            status: member.runtimeProfileRef ? 'idle' : 'unavailable',
            hasCredentials: Boolean(member.runtimeProfileRef),
          };
        const isActive =
          navState.layer === 'agent' && currentAgentId === agent.agentId;

        return (
          <div
            key={agent.agentId}
            style={isActive ? activeRowStyle : rowBaseStyle}
            onClick={() => handleAgentClick(agent.agentId, selectedTeam?.id ?? currentTeamId ?? '')}
          >
            <StatusBadge status={agent.status as AgentRunStatus} showLabel={false} />
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontFamily: isPixel ? "'Press Start 2P', monospace" : undefined,
              }}
            >
              {member.role}
            </span>
          </div>
        );
      })}

      {/* Footer: sidecar status */}
      <div style={footerStyle}>
        <div style={sidecarDotStyle} />
        <span>{sidecarReady ? 'Sidecar online' : 'Sidecar offline'}</span>
      </div>
    </div>
  );
}
