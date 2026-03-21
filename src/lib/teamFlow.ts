import type { AgentMessage, AgentStatus, MessageStreamDelta, Task } from './contracts';
import { getTopLevelRequestTasks } from './taskSelectors';

export interface TeamFlowNodeModel {
  id: string;
  label: string;
  kind: 'user' | 'manager' | 'agent';
  status?: AgentStatus['status'];
}

export interface TeamFlowEdgeModel {
  id: string;
  source: string;
  target: string;
  label: string;
  phase: 'request' | 'planning' | 'review' | 'execution';
  animated: boolean;
}

interface FlowCarrier {
  taskId: string;
  timestamp: number;
  meta?: AgentMessage['meta'];
  live: boolean;
}

export interface TeamFlowGraph {
  rootTaskId: string | null;
  nodes: TeamFlowNodeModel[];
  edges: TeamFlowEdgeModel[];
}

export function buildTeamFlowGraph(input: {
  tasks: Task[];
  messages: AgentMessage[];
  liveMessageDeltas: Record<string, MessageStreamDelta>;
  agentStatuses: AgentStatus[];
  selectedTaskId?: string | null;
}): TeamFlowGraph {
  const rootTaskId = resolveRootTaskId(input.tasks, input.selectedTaskId);
  if (!rootTaskId) {
    return { rootTaskId: null, nodes: [], edges: [] };
  }

  const relevantTaskIds = new Set<string>([
    rootTaskId,
    ...input.tasks
      .filter((task) => task.parentTaskId === rootTaskId)
      .map((task) => task.id),
  ]);
  const rootTask = input.tasks.find((task) => task.id === rootTaskId) ?? null;
  const managerId = rootTask?.managerAgentId ?? null;

  const flowCarriers: FlowCarrier[] = [
    ...input.messages
      .filter((message) => message.taskId && relevantTaskIds.has(message.taskId))
      .map((message) => ({
        taskId: message.taskId!,
        timestamp: message.timestamp,
        meta: message.meta,
        live: false,
      })),
    ...Object.values(input.liveMessageDeltas)
      .filter((delta) => relevantTaskIds.has(delta.taskId))
      .map((delta) => ({
        taskId: delta.taskId,
        timestamp: delta.timestamp,
        meta: delta.meta,
        live: true,
      })),
  ];

  const nodesById = new Map<string, TeamFlowNodeModel>();
  nodesById.set('user', { id: 'user', label: 'User', kind: 'user' });
  if (managerId) {
    const managerStatus = input.agentStatuses.find((agent) => agent.agentId === managerId);
    nodesById.set(managerId, {
      id: managerId,
      label: managerStatus?.role ?? 'Team Manager',
      kind: 'manager',
      status: managerStatus?.status,
    });
  }

  const edgesById = new Map<string, TeamFlowEdgeModel>();
  for (const entry of flowCarriers) {
    const flow = entry.meta?.flow;
    if (!flow) {
      continue;
    }

    const sourceStatus = input.agentStatuses.find((agent) => agent.agentId === flow.fromId);
    const targetStatus = input.agentStatuses.find((agent) => agent.agentId === flow.toId);

    if (!nodesById.has(flow.fromId)) {
      nodesById.set(flow.fromId, {
        id: flow.fromId,
        label:
          flow.fromId === 'user'
            ? 'User'
            : sourceStatus?.role ?? flow.fromId,
        kind:
          flow.fromId === 'user'
            ? 'user'
            : flow.fromId === managerId
              ? 'manager'
              : 'agent',
        status: sourceStatus?.status,
      });
    }
    if (!nodesById.has(flow.toId)) {
      nodesById.set(flow.toId, {
        id: flow.toId,
        label:
          flow.toId === 'user'
            ? 'User'
            : targetStatus?.role ?? flow.toId,
        kind:
          flow.toId === 'user'
            ? 'user'
            : flow.toId === managerId
              ? 'manager'
              : 'agent',
        status: targetStatus?.status,
      });
    }

    const edgeId = `${flow.fromId}->${flow.toId}:${flow.edgeLabel}:${flow.phase}`;
    edgesById.set(edgeId, {
      id: edgeId,
      source: flow.fromId,
      target: flow.toId,
      label: flow.edgeLabel,
      phase: flow.phase,
      animated: entry.live,
    });
  }

  return {
    rootTaskId,
    nodes: Array.from(nodesById.values()),
    edges: Array.from(edgesById.values()),
  };
}

function resolveRootTaskId(tasks: Task[], selectedTaskId?: string | null): string | null {
  if (selectedTaskId) {
    const selected = tasks.find((task) => task.id === selectedTaskId);
    if (selected) {
      return selected.parentTaskId ?? selected.id;
    }
  }

  return getTopLevelRequestTasks(tasks)[0]?.id ?? null;
}
