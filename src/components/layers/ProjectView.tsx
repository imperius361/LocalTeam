import React from 'react';
import { useState } from 'react';
import { useNav } from '../../navigation/NavContext';
import { useAppStore } from '../../store/appStore';
import { callSidecar } from '../../lib/ipc';

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

const TYPE_COLORS: Record<string, string> = {
  proposal: 'var(--cyan)',
  objection: 'var(--red)',
  consensus: 'var(--green)',
  discussion: 'var(--text-muted)',
  system: 'var(--text-muted)',
  artifact: 'var(--yellow)',
  user: 'var(--accent)',
};

export function ProjectView(): React.ReactElement {
  const { navState, navigate } = useNav();
  const snapshot = useAppStore((s) => s.snapshot);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dispatching, setDispatching] = useState(false);
  const [teamHovered, setTeamHovered] = useState(false);

  const projectPath = navState.layer === 'project' ? navState.projectPath : '';

  const agentStatuses = snapshot?.agentStatuses ?? [];
  const tasks = snapshot?.tasks ?? [];
  const messages = snapshot?.messages ?? [];
  const team = snapshot?.config?.team ?? null;

  const activeTasks = tasks.filter((t) => t.status === 'in_progress').length;

  const sortedMessages = [...messages]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 20);

  async function handleDispatch(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setDispatching(true);
    try {
      await callSidecar('v1.task.create', { title: title.trim(), description: description.trim() });
      setTitle('');
      setDescription('');
    } catch (err) {
      console.error('Failed to dispatch task:', err);
    } finally {
      setDispatching(false);
    }
  }

  const sectionHeaderStyle: React.CSSProperties = {
    fontSize: '9px',
    textTransform: 'uppercase',
    letterSpacing: '2px',
    color: 'var(--text-muted)',
    marginBottom: '8px',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: 'var(--bg-raised)',
    border: 'var(--border-width) solid var(--border)',
    padding: '6px 8px',
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-sans)',
    fontSize: '12px',
    boxSizing: 'border-box',
    outline: 'none',
  };

  return (
    <div
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
      {/* Left column */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '20px', overflowY: 'auto', minWidth: 0 }}>
        {/* Teams section */}
        <div>
          <div style={sectionHeaderStyle}>Teams</div>

          {team ? (
            <div
              onClick={() =>
                navigate({ layer: 'team', projectPath, teamId: team.name })
              }
              onMouseEnter={() => setTeamHovered(true)}
              onMouseLeave={() => setTeamHovered(false)}
              style={{
                background: 'var(--bg-panel)',
                border: `var(--border-width) solid ${teamHovered ? 'var(--accent)' : 'var(--border)'}`,
                padding: '14px',
                cursor: 'pointer',
                boxSizing: 'border-box',
                transition: 'border-color 0.15s ease',
              }}
            >
              {/* Team name */}
              <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>
                {team.name}
              </div>

              {/* Agent pips row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '6px', flexWrap: 'wrap' }}>
                {agentStatuses.map((a) => {
                  let color = 'var(--text-muted)';
                  if (a.status === 'unavailable') color = 'var(--red)';
                  else if (a.status !== 'idle') color = 'var(--yellow)';
                  else color = 'var(--green)';
                  return (
                    <div
                      key={a.agentId}
                      title={a.role}
                      style={{
                        width: '7px',
                        height: '7px',
                        borderRadius: '50%',
                        background: color,
                        flexShrink: 0,
                      }}
                    />
                  );
                })}
              </div>

              {/* Counts row */}
              <div style={{ display: 'flex', gap: '12px', fontSize: '11px', color: 'var(--text-muted)' }}>
                <span>{agentStatuses.length} agents</span>
                {activeTasks > 0 && (
                  <span style={{ color: 'var(--yellow)' }}>{activeTasks} active</span>
                )}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              No team configured.
            </div>
          )}
        </div>

        {/* Task submission form */}
        <div>
          <div style={sectionHeaderStyle}>Assign Task</div>
          <form onSubmit={handleDispatch} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <input
              type="text"
              placeholder="Task title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={inputStyle}
            />
            <textarea
              placeholder="Description (optional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={{ ...inputStyle, height: '80px', resize: 'none' }}
            />
            <button
              type="submit"
              disabled={dispatching || !title.trim()}
              onMouseEnter={(e) => {
                if (!dispatching && title.trim()) {
                  (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent)';
                  (e.currentTarget as HTMLButtonElement).style.color = 'white';
                }
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent-dim)';
                (e.currentTarget as HTMLButtonElement).style.color = 'var(--accent)';
              }}
              style={{
                background: 'var(--accent-dim)',
                color: 'var(--accent)',
                border: 'var(--border-width) solid var(--accent)',
                width: '100%',
                fontSize: '11px',
                textTransform: 'uppercase',
                cursor: dispatching ? 'not-allowed' : 'pointer',
                padding: '7px 0',
                letterSpacing: '1px',
                fontFamily: 'var(--font-sans)',
                transition: 'background 0.15s ease, color 0.15s ease',
                opacity: !title.trim() ? 0.5 : 1,
              }}
            >
              {dispatching ? 'Dispatching…' : '↵ Dispatch'}
            </button>
          </form>
        </div>
      </div>

      {/* Right column: Activity Feed */}
      <div
        style={{
          width: '300px',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div style={sectionHeaderStyle}>Activity Feed</div>

        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {sortedMessages.length === 0 ? (
            <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              No activity yet — dispatch a task to get started
            </div>
          ) : (
            sortedMessages.map((msg) => {
              const badgeColor = TYPE_COLORS[msg.type] ?? 'var(--text-muted)';
              const truncated =
                msg.content.length > 80
                  ? msg.content.slice(0, 80) + '…'
                  : msg.content;
              return (
                <div
                  key={msg.id}
                  style={{ fontSize: '11px', lineHeight: '1.4', borderBottom: '1px solid var(--border)', paddingBottom: '5px' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                    <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace', flexShrink: 0 }}>
                      {formatTime(msg.timestamp)}
                    </span>
                    <span style={{ color: badgeColor, textTransform: 'uppercase', fontSize: '9px', letterSpacing: '1px', flexShrink: 0 }}>
                      {msg.type}
                    </span>
                    <span style={{ fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {msg.agentRole}
                    </span>
                  </div>
                  <div style={{ color: 'var(--text-secondary)', wordBreak: 'break-word' }}>
                    {truncated}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
