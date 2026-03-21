import React from 'react';
import { useTheme } from '../../themes/ThemeContext';

interface ProgressBarProps {
  value: number;   // 0–100
  color?: string;  // CSS color or var(). Default: 'var(--accent)'
  height?: number; // px. Default: 2 (obsidian), 8 (pixel uses theme)
}

// Obsidian: thin 2px bar, no border
// Pixel: 8px bar with 2px solid border + segmented fill (repeating-linear-gradient stripes)
export function ProgressBar({ value, color = 'var(--accent)', height }: ProgressBarProps): React.ReactElement {
  const { theme } = useTheme();

  const isPixel = theme === 'pixel';
  const resolvedHeight = height ?? (isPixel ? 8 : 2);
  const clampedValue = Math.min(100, Math.max(0, value));

  const containerStyle: React.CSSProperties = {
    width: '100%',
    height: resolvedHeight,
    background: 'var(--border)',
    ...(isPixel ? { border: '2px solid var(--border)' } : {}),
    overflow: 'hidden',
    boxSizing: 'border-box',
  };

  const fillBackground = isPixel
    ? `${color}, repeating-linear-gradient(90deg, transparent 0px, transparent 5px, rgba(0,0,0,0.3) 5px, rgba(0,0,0,0.3) 6px)`
    : color;

  const fillStyle: React.CSSProperties = {
    width: `${clampedValue}%`,
    height: '100%',
    background: fillBackground,
    transition: 'width 0.2s ease',
  };

  return (
    <div style={containerStyle}>
      <div className="progress-bar-fill" style={fillStyle} />
    </div>
  );
}
