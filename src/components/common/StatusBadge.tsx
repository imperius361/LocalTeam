import React from 'react';
import { useTheme } from '../../themes/ThemeContext';

type AgentRunStatus = 'idle' | 'thinking' | 'writing' | 'waiting_for_consensus' | 'unavailable';

interface StatusBadgeProps {
  status: AgentRunStatus;
  showLabel?: boolean; // default true
}

// Maps agent status → display label + CSS color var
const STATUS_MAP: Record<AgentRunStatus, { label: string; color: string; pulse: boolean }> = {
  idle:                  { label: 'Idle',     color: 'var(--text-muted)', pulse: false },
  thinking:              { label: 'Thinking', color: 'var(--yellow)',     pulse: true  },
  writing:               { label: 'Writing',  color: 'var(--yellow)',     pulse: true  },
  waiting_for_consensus: { label: 'Waiting',  color: 'var(--cyan)',       pulse: true  },
  unavailable:           { label: 'Error',    color: 'var(--red)',        pulse: false },
};

const PULSE_STYLE_ID = 'status-badge-pulse-keyframes';

function ensurePulseKeyframes() {
  if (typeof document !== 'undefined' && !document.getElementById(PULSE_STYLE_ID)) {
    return (
      <style id={PULSE_STYLE_ID}>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    );
  }
  return null;
}

// Obsidian: rounded badge with border
// Pixel: square dot with Press Start 2P label
export function StatusBadge({ status, showLabel = true }: StatusBadgeProps): React.ReactElement {
  const { theme } = useTheme();
  const { label, color, pulse } = STATUS_MAP[status];

  const isPixel = theme === 'pixel';
  const borderRadius = isPixel ? 0 : '50%';

  const dotStyle: React.CSSProperties = {
    width: 6,
    height: 6,
    borderRadius,
    backgroundColor: color,
    flexShrink: 0,
    ...(pulse ? { animation: 'pulse 1.4s ease-in-out infinite' } : {}),
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    color,
    fontFamily: isPixel ? "'Press Start 2P', monospace" : undefined,
  };

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  };

  return (
    <>
      {pulse && ensurePulseKeyframes()}
      <div className="status-badge" style={containerStyle}>
        <div style={dotStyle} />
        {showLabel && <span style={labelStyle}>{label}</span>}
      </div>
    </>
  );
}
