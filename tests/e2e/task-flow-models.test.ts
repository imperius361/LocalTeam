import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type {
  AgentMessage,
  AgentStatus,
  MessageStreamDelta,
  Task,
} from '../../src/lib/contracts';
import { buildTaskTreeRows, countActiveRequestTasks } from '../../src/lib/taskSelectors';
import { buildTeamFlowGraph } from '../../src/lib/teamFlow';
import { ManagerReviewPanel } from '../../src/components/team/ManagerReviewPanel';
import { TaskHierarchyPanel } from '../../src/components/team/TaskHierarchyPanel';

function makeTask(overrides: Partial<Task> = {}): Task {
  const now = Date.now();
  return {
    id: overrides.id ?? 'task-1',
    title: overrides.title ?? 'Root Request',
    description: overrides.description ?? 'Review the auth boundary.',
    status: overrides.status ?? 'review',
    assignedAgents: overrides.assignedAgents ?? ['architect'],
    parentTaskId: overrides.parentTaskId,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    tokenEstimate: overrides.tokenEstimate ?? 0,
    sessionId: overrides.sessionId,
    consensusState: overrides.consensusState ?? 'pending',
    sandboxPath: overrides.sandboxPath,
    sandboxDiffStat: overrides.sandboxDiffStat,
    origin: overrides.origin ?? (overrides.parentTaskId ? 'agent_subtask' : 'user_request'),
    createdByAgentId: overrides.createdByAgentId,
    managerAgentId: overrides.managerAgentId ?? 'architect',
    reviewSummary: overrides.reviewSummary,
  };
}

function makeMessage(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: overrides.id ?? 'msg-1',
    agentId: overrides.agentId ?? 'user',
    agentRole: overrides.agentRole ?? 'User',
    type: overrides.type ?? 'user',
    content: overrides.content ?? 'Please review the auth boundary.',
    timestamp: overrides.timestamp ?? Date.now(),
    taskId: overrides.taskId ?? 'task-1',
    round: overrides.round,
    tokenEstimate: overrides.tokenEstimate ?? 10,
    meta: overrides.meta,
  };
}

function makeDelta(overrides: Partial<MessageStreamDelta> = {}): MessageStreamDelta {
  return {
    messageId: overrides.messageId ?? 'delta-1',
    taskId: overrides.taskId ?? 'task-1-child',
    agentId: overrides.agentId ?? 'engineer',
    agentRole: overrides.agentRole ?? 'Implementation Engineer',
    round: overrides.round ?? 1,
    delta: overrides.delta ?? 'AGREE',
    content: overrides.content ?? 'AGREE: implementation complete',
    timestamp: overrides.timestamp ?? Date.now(),
    meta: overrides.meta,
  };
}

describe('task presentation helpers', () => {
  it('renders root requests and agent subtasks as nested rows while excluding subtasks from root counts', () => {
    const rootTask = makeTask({
      id: 'root-1',
      title: 'Root Request',
      status: 'in_progress',
    });
    const childTask = makeTask({
      id: 'child-1',
      title: 'Implement Auth Boundary',
      parentTaskId: 'root-1',
      origin: 'agent_subtask',
      createdByAgentId: 'architect',
      status: 'pending',
    });

    const rows = buildTaskTreeRows([childTask, rootTask]);

    expect(rows).toHaveLength(2);
    expect(rows[0].task.id).toBe('root-1');
    expect(rows[0].depth).toBe(0);
    expect(rows[1].task.id).toBe('child-1');
    expect(rows[1].depth).toBe(1);
    expect(countActiveRequestTasks([rootTask, childTask])).toBe(1);
  });

  it('builds labeled graph edges from message flow metadata and marks live deltas as animated', () => {
    const tasks = [
      makeTask({ id: 'root-1', status: 'review', managerAgentId: 'architect' }),
      makeTask({
        id: 'child-1',
        title: 'Implement Auth Boundary',
        parentTaskId: 'root-1',
        origin: 'agent_subtask',
        createdByAgentId: 'architect',
        status: 'in_progress',
      }),
    ];
    const agentStatuses: AgentStatus[] = [
      {
        agentId: 'architect',
        role: 'Software Architect',
        model: 'mock',
        provider: 'mock',
        status: 'idle',
        hasCredentials: true,
      },
      {
        agentId: 'engineer',
        role: 'Implementation Engineer',
        model: 'mock',
        provider: 'mock',
        status: 'writing',
        hasCredentials: true,
      },
    ];
    const messages = [
      makeMessage({
        id: 'msg-user',
        taskId: 'root-1',
        meta: {
          flow: {
            fromId: 'user',
            toId: 'architect',
            edgeLabel: 'User Request',
            phase: 'request',
            audience: 'manager',
          },
        },
      }),
      makeMessage({
        id: 'msg-plan',
        agentId: 'architect',
        agentRole: 'Software Architect',
        type: 'proposal',
        taskId: 'root-1',
        content: 'Manager summary',
        meta: {
          flow: {
            fromId: 'architect',
            toId: 'user',
            edgeLabel: 'Plan',
            phase: 'review',
            audience: 'user',
          },
        },
      }),
    ];
    const liveMessageDeltas = {
      'delta-1': makeDelta({
        taskId: 'child-1',
        meta: {
          flow: {
            fromId: 'engineer',
            toId: 'architect',
            edgeLabel: 'Reports Back',
            phase: 'execution',
            audience: 'manager',
          },
        },
      }),
    };

    const graph = buildTeamFlowGraph({
      tasks,
      messages,
      liveMessageDeltas,
      agentStatuses,
      selectedTaskId: 'root-1',
    });

    expect(graph.rootTaskId).toBe('root-1');
    expect(graph.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(['user', 'architect', 'engineer']),
    );
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'User Request', source: 'user', target: 'architect' }),
        expect.objectContaining({ label: 'Plan', source: 'architect', target: 'user' }),
        expect.objectContaining({
          label: 'Reports Back',
          source: 'engineer',
          target: 'architect',
          animated: true,
        }),
      ]),
    );
  });

  it('renders the nested task tree and manager review controls', () => {
    const rootTask = makeTask({
      id: 'root-1',
      title: 'Review Request',
      reviewSummary: {
        proposalMessageId: 'msg-plan',
        summaryText: 'Manager review for auth boundary',
        presentedAt: 1,
      },
    });
    const childTask = makeTask({
      id: 'child-1',
      title: 'Implement Auth Boundary',
      parentTaskId: 'root-1',
      origin: 'agent_subtask',
      createdByAgentId: 'architect',
      status: 'pending',
    });
    const rows = buildTaskTreeRows([rootTask, childTask]);

    const hierarchyMarkup = renderToStaticMarkup(
      createElement(TaskHierarchyPanel, {
        rows,
        selectedRootTaskId: 'root-1',
        agentRoleById: {
          architect: 'Software Architect',
        },
        onSelectRootTask: () => {},
      }),
    );
    const reviewMarkup = renderToStaticMarkup(
      createElement(ManagerReviewPanel, {
        task: rootTask,
        managerRole: 'Software Architect',
        busyAction: null,
        error: null,
        modifyDraft: 'Tighten the auth boundary.',
        onModifyDraftChange: () => {},
        onApprove: () => {},
        onModify: () => {},
        onReject: () => {},
      }),
    );

    expect(hierarchyMarkup).toContain('Agent Subtask');
    expect(hierarchyMarkup).toContain('by Software Architect');
    expect(hierarchyMarkup).toContain('Implement Auth Boundary');
    expect(reviewMarkup).toContain('Software Architect summary');
    expect(reviewMarkup).toContain('Approve');
    expect(reviewMarkup).toContain('Modify');
    expect(reviewMarkup).toContain('Reject');
  });
});
