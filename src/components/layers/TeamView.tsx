import React, { useEffect, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { useNav } from '../../navigation/NavContext';
import { useAppStore } from '../../store/appStore';
import { respondToTaskReview } from '../../lib/ipc';
import type { AgentStatus } from '../../lib/contracts';
import { buildTaskTreeRows } from '../../lib/taskSelectors';
import { buildTeamFlowGraph } from '../../lib/teamFlow';
import { ManagerReviewPanel } from '../team/ManagerReviewPanel';
import { TaskHierarchyPanel } from '../team/TaskHierarchyPanel';

interface FlowNodeData extends Record<string, unknown> {
  id: string;
  label: string;
  kind: 'user' | 'manager' | 'agent';
  status?: AgentStatus['status'];
  onNavigate?: (agentId: string) => void;
}

function FlowNode({ data }: NodeProps<Node<FlowNodeData>>): React.ReactElement {
  const borderColor =
    data.kind === 'user'
      ? 'var(--accent)'
      : data.kind === 'manager'
        ? 'var(--yellow)'
        : 'var(--border)';
  const canNavigate = data.kind !== 'user' && typeof data.onNavigate === 'function';

  return (
    <div
      onClick={() => {
        if (canNavigate) {
          data.onNavigate?.(data.id);
        }
      }}
      style={{
        minWidth: 150,
        background: 'var(--bg-panel)',
        border: `1px solid ${borderColor}`,
        padding: '10px 12px',
        color: 'var(--text-primary)',
        cursor: canNavigate ? 'pointer' : 'default',
      }}
    >
      <Handle type="target" position={Position.Left} />
      <div
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '1px',
          color: 'var(--text-muted)',
          marginBottom: 4,
        }}
      >
        {data.kind}
      </div>
      <div style={{ fontSize: 12, marginBottom: 4 }}>{data.label}</div>
      {data.status && (
        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{data.status}</div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { flowNode: FlowNode };

export function TeamView(): React.ReactElement {
  const { navState, navigate } = useNav();
  const snapshot = useAppStore((s) => s.snapshot);
  const liveMessageDeltas = useAppStore((s) => s.liveMessageDeltas);
  const setSnapshot = useAppStore((s) => s.setSnapshot);

  const projectPath = navState.layer === 'team' ? navState.projectPath : '';
  const teamId = navState.layer === 'team' ? navState.teamId : '';

  const tasks = snapshot?.tasks ?? [];
  const taskRows = buildTaskTreeRows(tasks);
  const [selectedRootTaskId, setSelectedRootTaskId] = useState<string | null>(
    taskRows[0]?.task.id ?? null,
  );
  const [busyAction, setBusyAction] = useState<'approve' | 'modify' | 'reject' | null>(null);
  const [modifyDraft, setModifyDraft] = useState('');
  const [reviewError, setReviewError] = useState<string | null>(null);

  useEffect(() => {
    if (!taskRows.some((row) => row.depth === 0 && row.task.id === selectedRootTaskId)) {
      setSelectedRootTaskId(taskRows[0]?.task.id ?? null);
    }
  }, [selectedRootTaskId, taskRows]);

  const selectedRootTask =
    taskRows.find((row) => row.depth === 0 && row.task.id === selectedRootTaskId)?.task ?? null;
  const flowGraph = buildTeamFlowGraph({
    tasks,
    messages: snapshot?.messages ?? [],
    liveMessageDeltas,
    agentStatuses: snapshot?.agentStatuses ?? [],
    selectedTaskId: selectedRootTaskId,
  });

  const agentRoleById = Object.fromEntries(
    (snapshot?.agentStatuses ?? []).map((agent) => [agent.agentId, agent.role]),
  );
  const managerRole = selectedRootTask?.managerAgentId
    ? agentRoleById[selectedRootTask.managerAgentId]
    : undefined;

  const nodes = buildFlowNodes(flowGraph.nodes, (agentId) => {
    navigate({ layer: 'agent', projectPath, teamId, agentId });
  });
  const edges = buildFlowEdges(flowGraph.edges);

  const relevantTaskIds = new Set<string>();
  if (selectedRootTaskId) {
    relevantTaskIds.add(selectedRootTaskId);
    tasks
      .filter((task) => task.parentTaskId === selectedRootTaskId)
      .forEach((task) => relevantTaskIds.add(task.id));
  }
  const activity = (snapshot?.messages ?? [])
    .filter((message) => message.taskId && relevantTaskIds.has(message.taskId))
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, 10);

  async function handleReviewAction(action: 'approve' | 'modify' | 'reject') {
    if (!selectedRootTask) {
      return;
    }

    setBusyAction(action);
    setReviewError(null);
    try {
      const nextSnapshot = await respondToTaskReview(
        selectedRootTask.id,
        action,
        action === 'modify' ? modifyDraft.trim() : undefined,
      );
      setSnapshot(nextSnapshot);
      if (action !== 'modify') {
        setModifyDraft('');
      }
    } catch (error) {
      setReviewError(
        error instanceof Error && error.message.trim()
          ? error.message
          : 'Review action failed.',
      );
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, background: 'var(--bg-base)' }}>
      <div style={{ flex: 1, minWidth: 0, borderRight: '1px solid var(--border)' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          style={{ height: '100%', width: '100%' }}
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>

      <div
        style={{
          width: 420,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          padding: 12,
          boxSizing: 'border-box',
          overflowY: 'auto',
        }}
      >
        <TaskHierarchyPanel
          rows={taskRows}
          selectedRootTaskId={selectedRootTaskId}
          agentRoleById={agentRoleById}
          onSelectRootTask={setSelectedRootTaskId}
        />

        <ManagerReviewPanel
          task={selectedRootTask}
          managerRole={managerRole}
          busyAction={busyAction}
          error={reviewError}
          modifyDraft={modifyDraft}
          onModifyDraftChange={setModifyDraft}
          onApprove={() => {
            void handleReviewAction('approve');
          }}
          onModify={() => {
            void handleReviewAction('modify');
          }}
          onReject={() => {
            void handleReviewAction('reject');
          }}
        />

        <section style={{ minHeight: 0 }}>
          <div
            style={{
              fontSize: 9,
              textTransform: 'uppercase',
              letterSpacing: '2px',
              color: 'var(--text-muted)',
              marginBottom: 8,
            }}
          >
            Activity
          </div>
          <div
            style={{
              border: '1px solid var(--border)',
              background: 'var(--bg-panel)',
              minHeight: 120,
              maxHeight: 260,
              overflowY: 'auto',
            }}
          >
            {activity.length === 0 ? (
              <div style={{ padding: 12, fontSize: 11, color: 'var(--text-muted)' }}>
                No activity for the selected request yet.
              </div>
            ) : (
              activity.map((message) => (
                <div
                  key={message.id}
                  style={{
                    padding: '10px 12px',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>
                    {message.agentRole} • {message.type}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                    {message.content}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function buildFlowNodes(
  nodes: Array<{ id: string; label: string; kind: 'user' | 'manager' | 'agent'; status?: AgentStatus['status'] }>,
  onNavigate: (agentId: string) => void,
): Node[] {
  const userNode = nodes.find((node) => node.kind === 'user');
  const managerNode = nodes.find((node) => node.kind === 'manager');
  const agentNodes = nodes.filter((node) => node.kind === 'agent');

  const reactNodes: Node[] = [];
  if (userNode) {
    reactNodes.push({
      id: userNode.id,
      type: 'flowNode',
      position: { x: 40, y: 220 },
      data: { ...userNode, onNavigate } satisfies FlowNodeData,
    });
  }
  if (managerNode) {
    reactNodes.push({
      id: managerNode.id,
      type: 'flowNode',
      position: { x: 300, y: 220 },
      data: { ...managerNode, onNavigate } satisfies FlowNodeData,
    });
  }

  const yStart = 80;
  const step = 140;
  for (const [index, node] of agentNodes.entries()) {
    reactNodes.push({
      id: node.id,
      type: 'flowNode',
      position: { x: 580, y: yStart + index * step },
      data: { ...node, onNavigate } satisfies FlowNodeData,
    });
  }

  return reactNodes;
}

function buildFlowEdges(
  edges: Array<{ id: string; source: string; target: string; label: string; phase: string; animated: boolean }>,
): Edge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    animated: edge.animated,
    label: edge.label,
    type: 'smoothstep',
    style: {
      stroke: getEdgeColor(edge.phase),
      strokeWidth: 1.5,
    },
    labelStyle: {
      fill: 'var(--text-muted)',
      fontSize: 10,
    },
  }));
}

function getEdgeColor(phase: string): string {
  switch (phase) {
    case 'request':
      return 'var(--accent)';
    case 'planning':
      return 'var(--cyan)';
    case 'review':
      return 'var(--yellow)';
    case 'execution':
      return 'var(--green)';
    default:
      return 'var(--border)';
  }
}
