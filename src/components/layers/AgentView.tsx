import React, { useState } from 'react';
import { useNav } from '../../navigation/NavContext';
import { useAppStore } from '../../store/appStore';
import { restartSidecar } from '../../lib/ipc';
import { StatusBadge } from '../common/StatusBadge';
import { ProgressBar } from '../common/ProgressBar';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(ts: number): string {
  const d = new Date(ts);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
}

function formatUptime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const hh = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function relativeTime(ts: number): string {
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 60) return 'just now';
  return `${Math.floor(diffSec / 60)}m ago`;
}

function initials(role: string): string {
  return role
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase();
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

const btnBase: React.CSSProperties = {
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

const statLabelStyle: React.CSSProperties = {
  fontSize: 9,
  textTransform: 'uppercase',
  letterSpacing: '1px',
  color: 'var(--text-muted)',
  marginBottom: 2,
};

const statValueStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
};

// ── AgentView ─────────────────────────────────────────────────────────────────

export function AgentView(): React.ReactElement {
  const { navState } = useNav();
  const snapshot = useAppStore((s) => s.snapshot);
  const taskMap = useAppStore((s) => s.taskMap);
  const messagesByTask = useAppStore((s) => s.messagesByTask);
  const agentStatusMap = useAppStore((s) => s.agentStatusMap);

  const agentId = navState.layer === 'agent' ? navState.agentId : '';

  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'live' | 'ipc' | 'stderr'>('live');

  const agentStatus = agentStatusMap[agentId];
  const consensus = snapshot?.consensus ?? [];
  const allTasks = Object.values(taskMap);
  const agentTasks = allTasks.filter((t) => t.assignedAgents.includes(agentId));

  // Stats
  const tokenSum = agentTasks.reduce((sum, t) => sum + (t.tokenEstimate ?? 0), 0);
  const completedCount = agentTasks.filter((t) => t.status === 'completed').length;
  const uptime = snapshot?.sidecar?.uptime ?? 0;
  const lastError = agentStatus?.lastError ?? 'None';

  const reviewTasks = agentTasks.filter((t) => t.status === 'review');
  const cancelledTasks = agentTasks.filter((t) => t.status === 'cancelled');

  // Task groups: in_progress → review → pending → completed → cancelled
  const inProgressTasks = agentTasks.filter((t) => t.status === 'in_progress');
  const pendingTasks = agentTasks.filter((t) => t.status === 'pending');
  const completedTasks = agentTasks.filter((t) => t.status === 'completed');
  const orderedTasks = [
    ...inProgressTasks,
    ...reviewTasks,
    ...pendingTasks,
    ...completedTasks,
    ...cancelledTasks,
  ];

  // Active task for message display
  const resolvedTaskId = activeTaskId ?? inProgressTasks[0]?.id ?? orderedTasks[0]?.id ?? '';
  const activeTask = taskMap[resolvedTaskId];
  const activeMessages = messagesByTask[resolvedTaskId] ?? [];

  // Terminal log lines
  const terminalMessages = [...(snapshot?.messages ?? [])]
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-20);

  if (!agentStatus) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-base)', color: 'var(--text-muted)', fontSize: 12 }}>
        Agent not found: {agentId}
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-base)' }}>

      {/* ── Agent Header ─────────────────────────────────────────────────── */}
      <div style={{ flexShrink: 0, background: 'var(--bg-panel)', borderBottom: 'var(--border-width) solid var(--border)', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 36, height: 36, background: 'var(--accent-dim)', border: '1px solid var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: 'var(--accent)', flexShrink: 0 }}>
          {initials(agentStatus.role)}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{agentStatus.role}</div>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-muted)', marginTop: 2 }}>
            {agentStatus.role} · {agentStatus.model} · {agentStatus.provider}
          </div>
        </div>
        <StatusBadge status={agentStatus.status} />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <button style={btnBase} onClick={() => restartSidecar().catch(console.error)}>Restart</button>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Read-only view</span>
        </div>
      </div>

      {/* ── Stats Strip ──────────────────────────────────────────────────── */}
      <div style={{ flexShrink: 0, display: 'flex', borderBottom: 'var(--border-width) solid var(--border)' }}>
        {[
          { label: 'ROUND', value: `${consensus[0]?.round ?? '--'}`, sub: `/ ${snapshot?.config?.consensus?.maxRounds ?? '--'}` },
          { label: 'TOKENS', value: tokenSum.toLocaleString(), sub: undefined },
          { label: 'COMPLETED', value: `${completedCount}`, sub: `/ ${agentTasks.length}` },
          { label: 'UPTIME', value: formatUptime(uptime), sub: undefined },
          { label: 'LAST ERROR', value: lastError.length > 30 ? lastError.slice(0, 30) + '…' : lastError, sub: undefined },
        ].map((stat, i, arr) => (
          <div
            key={stat.label}
            style={{
              flex: 1,
              padding: '10px 14px',
              borderRight: i < arr.length - 1 ? '1px solid var(--border)' : undefined,
              minWidth: 0,
            }}
          >
            <div className="stat-label" style={statLabelStyle}>{stat.label}</div>
            <div style={statValueStyle}>{stat.value}</div>
            {stat.sub && <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>{stat.sub}</div>}
          </div>
        ))}
      </div>

      {/* ── Middle Panels ────────────────────────────────────────────────── */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>

        {/* Task Queue */}
        <div style={{ width: 260, flexShrink: 0, borderRight: '1px solid var(--border)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
          <div style={{ flexShrink: 0, padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '2px', color: 'var(--text-muted)' }}>Task Queue</span>
            <span style={{ fontSize: 9, background: 'var(--bg-raised)', color: 'var(--text-muted)', padding: '1px 5px', border: '1px solid var(--border)' }}>{agentTasks.length}</span>
          </div>

          {/* Task items */}
          <div style={{ flex: 1 }}>
            {orderedTasks.length === 0 ? (
              <div style={{ padding: '12px', fontSize: 11, color: 'var(--text-muted)' }}>No tasks assigned</div>
            ) : (
              orderedTasks.map((task) => {
                const isActive = task.id === resolvedTaskId;
                const isInProgress = task.status === 'in_progress';
                const isReview = task.status === 'review';
                return (
                  <div
                    key={task.id}
                    onClick={() => setActiveTaskId(task.id)}
                    style={{
                      padding: '10px 12px',
                      cursor: 'pointer',
                      borderBottom: '1px solid var(--border)',
                      borderLeft: isActive ? 'var(--border-width) solid var(--accent)' : 'var(--border-width) solid transparent',
                      background: isActive ? 'var(--bg-raised)' : 'transparent',
                    }}
                    >
                    {/* Status label */}
                    <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3, color: isInProgress ? 'var(--yellow)' : isReview ? 'var(--cyan)' : task.status === 'completed' ? 'var(--green)' : task.status === 'cancelled' ? 'var(--red)' : 'var(--text-muted)' }}>
                      {isInProgress
                        ? '● IN PROGRESS'
                        : isReview
                          ? '! REVIEW'
                          : task.status === 'completed'
                            ? '✓ DONE'
                            : task.status === 'cancelled'
                              ? '× CANCELLED'
                              : '○ PENDING'}
                    </div>
                    {/* Title */}
                    <div className="task-item-title" style={{ fontSize: 12, color: 'var(--text-primary)', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {task.origin === 'agent_subtask' ? '>' : '#'} {task.title}
                    </div>
                    {/* Meta */}
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: isInProgress ? 6 : 0 }}>
                      {task.origin === 'agent_subtask' && task.createdByAgentId
                        ? `from ${snapshot?.agentStatuses.find((entry) => entry.agentId === task.createdByAgentId)?.role ?? task.createdByAgentId} · `
                        : ''}
                      {relativeTime(task.updatedAt)}
                    </div>
                    {/* Progress bar for in_progress */}
                    {isInProgress && <ProgressBar value={50} color="var(--yellow)" />}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Message Stream */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flexShrink: 0, padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '2px', color: 'var(--text-muted)' }}>Discussion Stream</span>
            {activeTask && <span style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>— {activeTask.title}</span>}
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {activeMessages.length === 0 ? (
              <div style={{ padding: '12px 16px', fontSize: 11, color: 'var(--text-muted)' }}>No messages for this task</div>
            ) : (
              activeMessages.map((msg) => {
                const typeColor = TYPE_COLORS[msg.type] ?? 'var(--text-muted)';
                return (
                  <div key={msg.id} style={{ display: 'flex', gap: 10, padding: '8px 16px', fontSize: 12, lineHeight: 1.5, borderBottom: '1px solid var(--border)' }}>
                    {/* Timestamp */}
                    <span className="activity-item-time" style={{ width: 50, flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)' }}>
                      {formatTime(msg.timestamp)}
                    </span>
                    {/* Type tag */}
                    <span style={{ width: 72, flexShrink: 0, fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.5px', color: typeColor }}>
                      {msg.type}
                    </span>
                    {/* Body */}
                    <span style={{ flex: 1, color: 'var(--text-secondary)', minWidth: 0, wordBreak: 'break-word' }}>
                      <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{msg.agentRole}</span>
                      {' '}
                      <span>{msg.content}</span>
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* ── Terminal ─────────────────────────────────────────────────────── */}
      <div style={{ height: 200, flexShrink: 0, background: '#0a0b0f', borderTop: 'var(--border-width) solid var(--border)', display: 'flex', flexDirection: 'column' }}>
        {/* Tabs row */}
        <div style={{ flexShrink: 0, background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center' }}>
          {(['live', 'ipc', 'stderr'] as const).map((tab) => {
            const label = tab === 'live' ? 'LIVE OUTPUT' : tab === 'ipc' ? 'IPC LOG' : 'STDERR';
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={isActive ? 'terminal-tab terminal-tab-active' : 'terminal-tab'}
                style={{
                  background: 'transparent',
                  border: 'none',
                  borderBottom: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                  color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  padding: '6px 12px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {label}
              </button>
            );
          })}

        </div>

        {/* Terminal body */}
        <div style={{ flex: 1, overflowY: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.7, padding: '4px 0' }}>
          {activeTab === 'live' && terminalMessages.map((msg) => {
            let color = 'var(--text-muted)';
            if (msg.type === 'system') color = '#4a7adf';
            else if (msg.type === 'consensus') color = 'var(--green)';
            else if (msg.type === 'objection') color = 'var(--red)';
            const label = msg.type.toUpperCase().padEnd(9);
            const truncated = msg.content.length > 80 ? msg.content.slice(0, 80) + '…' : msg.content;
            return (
              <div key={msg.id} style={{ padding: '0 12px', color }}>
                [{formatTime(msg.timestamp)}] [{label}] {msg.agentRole} → {truncated}
              </div>
            );
          })}

          {activeTab === 'ipc' && (
            <div style={{ padding: '8px 12px', color: snapshot?.sidecar?.lastError ? 'var(--red)' : 'var(--text-muted)' }}>
              {snapshot?.sidecar?.lastError ?? 'No IPC errors'}
            </div>
          )}

          {activeTab === 'stderr' && (
            <div style={{ padding: '8px 12px', color: 'var(--text-muted)' }}>
              Stderr stream not yet connected.
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
