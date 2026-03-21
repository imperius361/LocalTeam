import React from 'react';
import { useNav } from '../navigation/NavContext';
import { useAppStore } from '../store/appStore';
import { useTheme } from '../themes/ThemeContext';
import type { NavLayer } from '../navigation/types';

function getBreadcrumbLabel(entry: NavLayer, teamName?: string): string {
  switch (entry.layer) {
    case 'global':
      return 'Global';
    case 'project':
      return teamName ?? entry.projectPath;
    case 'team':
      return entry.teamId;
    case 'agent':
      return entry.agentId;
  }
}

export function Topbar(): React.ReactElement {
  const { navStack, navigateTo } = useNav();
  const snapshot = useAppStore((s) => s.snapshot);
  const { theme, resetTheme } = useTheme();

  const isPixel = theme === 'pixel';

  const projectName = snapshot?.config?.team?.name;

  // Compute metrics
  const activeAgentCount =
    snapshot?.agentStatuses.filter(
      (a) => a.status !== 'unavailable' && a.status !== 'idle'
    ).length ?? 0;

  const tasksRunning =
    snapshot?.tasks.filter((t) => t.status === 'in_progress').length ?? 0;

  const sidecarReady = snapshot?.sidecar?.ready ?? false;

  const containerStyle: React.CSSProperties = {
    height: 40,
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: '0 12px',
    background: 'var(--bg-panel)',
    borderBottom: 'var(--border-width) solid var(--border)',
    flexShrink: 0,
    boxSizing: 'border-box',
  };

  const logoStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 3,
    color: 'var(--text-primary)',
    whiteSpace: 'nowrap',
    fontFamily: isPixel ? "'Press Start 2P', monospace" : undefined,
  };

  const dividerStyle: React.CSSProperties = {
    width: 1,
    height: 18,
    background: 'var(--border)',
    flexShrink: 0,
  };

  const breadcrumbContainerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    overflow: 'hidden',
  };

  const separatorStyle: React.CSSProperties = {
    fontSize: 11,
    color: 'var(--text-muted)',
    flexShrink: 0,
  };

  const rightStyle: React.CSSProperties = {
    marginLeft: 'auto',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
  };

  const metricsStyle: React.CSSProperties = {
    fontSize: 10,
    color: 'var(--text-muted)',
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  };

  const metricValueStyle: React.CSSProperties = {
    color: 'var(--text-secondary)',
  };

  const sidecarDotStyle: React.CSSProperties = {
    width: 6,
    height: 6,
    borderRadius: isPixel ? 0 : '50%',
    backgroundColor: sidecarReady ? 'var(--green, #4ade80)' : 'var(--red, #f87171)',
    flexShrink: 0,
  };

  const settingsButtonStyle: React.CSSProperties = {
    fontSize: 10,
    color: 'var(--text-muted)',
    background: 'none',
    border: '1px solid var(--border)',
    padding: '2px 6px',
    cursor: 'pointer',
    fontFamily: isPixel ? "'Press Start 2P', monospace" : undefined,
  };

  const separator = isPixel ? '»' : '›';

  return (
    <div style={containerStyle}>
      {/* Logo */}
      <span className="topbar-logo" style={logoStyle}>
        {isPixel ? '⚔ LOCALTEAM' : 'LOCALTEAM'}
      </span>

      {/* Divider */}
      <div style={dividerStyle} />

      {/* Breadcrumb */}
      <nav style={breadcrumbContainerStyle}>
        {navStack.map((entry, index) => {
          const isLast = index === navStack.length - 1;
          const label = getBreadcrumbLabel(
            entry,
            entry.layer === 'project' ? projectName : undefined
          );

          return (
            <React.Fragment key={index}>
              {index > 0 && (
                <span className="topbar-breadcrumb-sep" style={separatorStyle}>{separator}</span>
              )}
              {isLast ? (
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--text-primary)',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {label}
                </span>
              ) : (
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                  onClick={() => navigateTo(index)}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLSpanElement).style.color = 'var(--accent)';
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLSpanElement).style.color = 'var(--text-secondary)';
                  }}
                >
                  {label}
                </span>
              )}
            </React.Fragment>
          );
        })}
      </nav>

      {/* Right side: metrics + settings */}
      <div style={rightStyle}>
        <div style={metricsStyle}>
          <span>
            Agents{' '}
            <span style={metricValueStyle}>{activeAgentCount}</span>
          </span>
          <span>
            Tasks{' '}
            <span style={metricValueStyle}>{tasksRunning}</span>
          </span>
          <div style={sidecarDotStyle} title={sidecarReady ? 'Sidecar online' : 'Sidecar offline'} />
        </div>
        <button style={settingsButtonStyle} onClick={resetTheme}>
          Settings
        </button>
      </div>
    </div>
  );
}
