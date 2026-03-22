import React, { useState } from 'react';
import { useTheme } from '../themes/ThemeContext';
import type { ThemeName } from '../themes/ThemeContext';

type HoveredCard = ThemeName | null;

export function ThemeSelector() {
  const { setTheme } = useTheme();
  const [hoveredCard, setHoveredCard] = useState<HoveredCard>(null);

  const overlay: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: '#0a0b0f',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    gap: '40px',
  };

  const header: React.CSSProperties = {
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  };

  const title: React.CSSProperties = {
    color: '#e2e8f0',
    fontSize: '24px',
    fontWeight: 'bold',
    margin: 0,
  };

  const subtitle: React.CSSProperties = {
    color: '#4a5568',
    fontSize: '14px',
    margin: 0,
  };

  const cardsRow: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'row',
    gap: '24px',
  };

  function cardStyle(id: ThemeName, hoverColor: string): React.CSSProperties {
    return {
      background: '#13161d',
      border: `2px solid ${hoveredCard === id ? hoverColor : '#252836'}`,
      borderRadius: '12px',
      padding: '20px',
      width: '220px',
      cursor: 'pointer',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      transition: 'border-color 0.15s ease',
      textAlign: 'left',
      appearance: 'none',
    };
  }

  const cardLabel: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  };

  const cardName: React.CSSProperties = {
    color: '#e2e8f0',
    fontSize: '16px',
    fontWeight: 'bold',
    margin: 0,
  };

  const cardSubtitle: React.CSSProperties = {
    color: '#4a5568',
    fontSize: '12px',
    margin: 0,
  };

  const cardDescription: React.CSSProperties = {
    color: '#4a5568',
    fontSize: '12px',
    margin: 0,
    lineHeight: 1.4,
  };

  // Obsidian mini preview
  const obsidianPreview = (
    <div
      style={{
        background: '#1a1b26',
        borderRadius: '6px',
        height: '120px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Top bar */}
      <div style={{ background: '#16172a', height: '18px', flexShrink: 0, borderBottom: '1px solid #252836' }} />
      <div style={{ display: 'flex', flex: 1 }}>
        {/* Left sidebar */}
        <div style={{ background: '#13141f', width: '36px', flexShrink: 0, borderRight: '1px solid #252836' }} />
        {/* Main area */}
        <div style={{ flex: 1, padding: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ background: '#252836', borderRadius: '3px', height: '22px', border: '1px solid #5865f2' }} />
          <div style={{ background: '#252836', borderRadius: '3px', height: '22px', border: '1px solid #252836' }} />
        </div>
      </div>
    </div>
  );

  // Pixel mini preview
  const pixelPreview = (
    <div
      style={{
        background: '#1a1c2c',
        borderRadius: '6px',
        height: '120px',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Top bar */}
      <div style={{ background: '#16213e', height: '18px', flexShrink: 0, borderBottom: '3px solid #4ecdc4' }} />
      <div style={{ display: 'flex', flex: 1 }}>
        {/* Left sidebar */}
        <div style={{ background: '#0f3460', width: '36px', flexShrink: 0, borderRight: '3px solid #ffd93d' }} />
        {/* Main area */}
        <div style={{ flex: 1, padding: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ background: '#0f3460', borderRadius: '0px', height: '22px', border: '2px solid #4ecdc4' }} />
          <div style={{ background: '#0f3460', borderRadius: '0px', height: '22px', border: '2px solid #ffd93d' }} />
        </div>
      </div>
    </div>
  );

  return (
    <div style={overlay} data-testid="theme-selector">
      <div style={header}>
        <p style={title}>Choose Your Interface</p>
        <p style={subtitle}>You can change this later in settings</p>
      </div>

      <div style={cardsRow}>
        {/* Obsidian card */}
        <button
          type="button"
          data-testid="theme-card-obsidian"
          style={cardStyle('obsidian', '#5865f2')}
          onMouseEnter={() => setHoveredCard('obsidian')}
          onMouseLeave={() => setHoveredCard(null)}
          onClick={() => setTheme('obsidian')}
        >
          {obsidianPreview}
          <div style={cardLabel}>
            <p style={cardName}>Obsidian</p>
            <p style={cardSubtitle}>Developer Dark</p>
          </div>
          <p style={cardDescription}>Sharp, minimal. Built for focus.</p>
        </button>

        {/* Pixel card */}
        <button
          type="button"
          data-testid="theme-card-pixel"
          style={cardStyle('pixel', '#4ecdc4')}
          onMouseEnter={() => setHoveredCard('pixel')}
          onMouseLeave={() => setHoveredCard(null)}
          onClick={() => setTheme('pixel')}
        >
          {pixelPreview}
          <div style={cardLabel}>
            <p style={cardName}>Pixel Strategy</p>
            <p style={cardSubtitle}>Retro Game UI</p>
          </div>
          <p style={cardDescription}>Chunky, colorful. Built for fun.</p>
        </button>
      </div>
    </div>
  );
}
