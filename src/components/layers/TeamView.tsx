import React, { useCallback, useEffect } from 'react';
import {
  ReactFlow,
  Node,
  Edge,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useNav } from '../../navigation/NavContext';
import { useAppStore } from '../../store/appStore';
import { StatusBadge } from '../common/StatusBadge';
import { ProgressBar } from '../common/ProgressBar';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AgentNodeData extends Record<string, unknown> {
  agentId: string;
  role: string;
  model: string;
  provider: string;
  status: 'idle' | 'thinking' | 'writing' | 'waiting_for_consensus' | 'unavailable';
  hasCredentials: boolean;
  tokenEstimate: number;
  onNavigate: (agentId: string) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(ts: number): string {
  const d = new Date(ts);
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((n) => String(n).padStart(2, '0'))
    .join(':');
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

// ── AgentNode ─────────────────────────────────────────────────────────────────

function AgentNode({ data }: NodeProps<Node<AgentNodeData>>): React.ReactElement {
  const { agentId, role, status, tokenEstimate, onNavigate } = data;
  const isActive = status !== 'idle';
  const isError = status === 'unavailable';

  const containerStyle: React.CSSProperties = {
    background: 'var(--bg-panel)',
    border: `1px solid ${isError ? 'var(--red)' : 'var(--border)'}`,
    padding: '12px 14px',
    width: 160,
    cursor: 'pointer',
    boxSizing: 'border-box',
    ...(isActive
      ? { boxShadow: '0 0 0 1px var(--accent), 0 4px 16px rgba(88,101,242,0.2)' }
      : {}),
  };

  return (
    <div style={containerStyle} onClick={() => onNavigate(agentId)}>
      <Handle type="target" position={Position.Top} />

      {/* Header: avatar + role */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <div
          style={{
            width: 26,
            height: 26,
            background: 'var(--accent-dim)',
            border: '1px solid var(--accent)',
            color: 'var(--accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {initials(role)}
        </div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: 'var(--text-primary)',
          }}
        >
          {role}
        </div>
      </div>

      {/* Status badge */}
      <div style={{ marginBottom: 8 }}>
        <StatusBadge status={status} />
      </div>

      {/* Token bar */}
      <ProgressBar value={Math.min((tokenEstimate / 6000) * 100, 100)} />

      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const nodeTypes = { agentNode: AgentNode };

// ── Layout helpers ────────────────────────────────────────────────────────────

function buildLayout(
  agentStatuses: Array<{
    agentId: string;
    role: string;
    model: string;
    provider: string;
    status: 'idle' | 'thinking' | 'writing' | 'waiting_for_consensus' | 'unavailable';
    hasCredentials: boolean;
  }>,
  onNavigate: (id: string) => void,
): Node[] {
  const count = agentStatuses.length;
  if (count === 0) return [];

  const yBase = 200;
  const spacing = 250;

  // Compute x start so agents are centered around x=400
  const totalWidth = (count - 1) * spacing;
  const xStart = 400 - totalWidth / 2;

  return agentStatuses.map((a, i) => ({
    id: a.agentId,
    type: 'agentNode',
    position: { x: xStart + i * spacing, y: yBase },
    data: {
      agentId: a.agentId,
      role: a.role,
      model: a.model,
      provider: a.provider,
      status: a.status,
      hasCredentials: a.hasCredentials,
      tokenEstimate: 0,
      onNavigate,
    } satisfies AgentNodeData,
  }));
}

function buildEdges(
  messages: Array<{ id: string; agentId: string; type: string; taskId?: string }>,
  agentIds: string[],
  animated: boolean,
): Edge[] {
  const taskMessages = messages.filter(
    (m) =>
      m.taskId &&
      (m.type === 'proposal' || m.type === 'objection' || m.type === 'discussion'),
  );

  if (taskMessages.length === 0 || agentIds.length < 2) return [];

  const seen = new Set<string>();
  const edges: Edge[] = [];

  for (const msg of taskMessages) {
    const srcIdx = agentIds.indexOf(msg.agentId);
    if (srcIdx === -1) continue;
    const tgtIdx = (srcIdx + 1) % agentIds.length;
    const key = `${agentIds[srcIdx]}->${agentIds[tgtIdx]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({
      id: key,
      source: agentIds[srcIdx],
      target: agentIds[tgtIdx],
      animated,
    });
  }

  return edges;
}

// ── TeamView ──────────────────────────────────────────────────────────────────

export function TeamView(): React.ReactElement {
  const { navState, navigate } = useNav();
  const snapshot = useAppStore((s) => s.snapshot);

  const projectPath = navState.layer === 'team' ? navState.projectPath : '';
  const teamId = navState.layer === 'team' ? navState.teamId : '';

  const agentStatuses = snapshot?.agentStatuses ?? [];
  const messages = snapshot?.messages ?? [];
  const consensus = snapshot?.consensus ?? [];

  const isAnyActive = agentStatuses.some((a) => a.status !== 'idle');

  const handleNavigate = useCallback(
    (agentId: string) => {
      navigate({ layer: 'agent', projectPath, teamId, agentId });
    },
    [navigate, projectPath, teamId],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    const agentIds = agentStatuses.map((a) => a.agentId);
    const newNodes = buildLayout(agentStatuses, handleNavigate);

    // Consensus node
    if (consensus.length > 0 && consensus.some((c) => c.status !== 'reached')) {
      const lastX =
        newNodes.length > 0
          ? Math.max(...newNodes.map((n) => n.position.x))
          : 400;
      const supporters = consensus[0]?.supporters ?? [];
      newNodes.push({
        id: 'consensus',
        type: 'default',
        position: { x: lastX + 250, y: 200 },
        data: { label: `Consensus\n${supporters.length}/${agentStatuses.length}` },
      });
    }

    const newEdges = buildEdges(messages, agentIds, isAnyActive);

    setNodes(newNodes);
    setEdges(newEdges);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentStatuses, messages, consensus, isAnyActive]);

  // Activity panel: last 10 messages newest-first
  const recentMessages = [...messages]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 10);

  const sectionHeader: React.CSSProperties = {
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: '2px',
    color: 'var(--text-muted)',
    marginBottom: 8,
    flexShrink: 0,
  };

  return (
    <div style={{ display: 'flex', flex: 1, height: '100%', overflow: 'hidden' }}>
      {/* Graph canvas */}
      <div style={{ flex: 1, background: 'var(--bg-base)', position: 'relative', height: '100%' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          style={{ height: '100%', width: '100%' }}
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>

      {/* Activity panel */}
      <div
        style={{
          width: 200,
          flexShrink: 0,
          background: 'var(--bg-panel)',
          borderLeft: '1px solid var(--border)',
          display: 'flex',
          flexDirection: 'column',
          padding: '12px 10px',
          overflow: 'hidden',
          boxSizing: 'border-box',
        }}
      >
        <div style={sectionHeader}>Activity</div>
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {recentMessages.length === 0 ? (
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>No activity yet</div>
          ) : (
            recentMessages.map((msg) => {
              const badgeColor = TYPE_COLORS[msg.type] ?? 'var(--text-muted)';
              const truncated =
                msg.content.length > 60 ? msg.content.slice(0, 60) + '…' : msg.content;
              return (
                <div
                  key={msg.id}
                  style={{
                    fontSize: 10,
                    lineHeight: 1.4,
                    borderBottom: '1px solid var(--border)',
                    paddingBottom: 4,
                  }}
                >
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 2, flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace', flexShrink: 0 }}>
                      {formatTime(msg.timestamp)}
                    </span>
                    <span
                      style={{
                        color: badgeColor,
                        textTransform: 'uppercase',
                        fontSize: 8,
                        letterSpacing: '1px',
                        flexShrink: 0,
                      }}
                    >
                      {msg.type}
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
