import { randomUUID } from 'node:crypto';
import type { Task, TaskStatus } from './types.js';

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ['in_progress'],
  in_progress: ['review', 'completed'],
  review: ['completed', 'in_progress'],
  completed: [],
};

export class TaskManager {
  private tasks = new Map<string, Task>();

  hydrate(tasks: Task[]): void {
    this.tasks = new Map(tasks.map((task) => [task.id, { ...task }]));
  }

  create(
    title: string,
    description: string,
    overrides: Partial<Task> = {},
  ): Task {
    const now = Date.now();
    const task: Task = {
      id: overrides.id ?? randomUUID(),
      title,
      description,
      status: overrides.status ?? 'pending',
      assignedAgents: overrides.assignedAgents ?? [],
      parentTaskId: overrides.parentTaskId,
      createdAt: overrides.createdAt ?? now,
      updatedAt: overrides.updatedAt ?? now,
      tokenEstimate: overrides.tokenEstimate ?? 0,
      sessionId: overrides.sessionId,
      consensusState: overrides.consensusState,
      sandboxPath: overrides.sandboxPath,
      sandboxDiffStat: overrides.sandboxDiffStat,
    };
    this.tasks.set(task.id, task);
    return { ...task };
  }

  createSubtask(parentId: string, title: string, description: string): Task {
    const task = this.create(title, description, { parentTaskId: parentId });
    const stored = this.tasks.get(task.id)!;
    stored.parentTaskId = parentId;
    return { ...stored };
  }

  get(id: string): Task | undefined {
    const task = this.tasks.get(id);
    return task ? { ...task } : undefined;
  }

  transition(id: string, newStatus: TaskStatus): void {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task not found: ${id}`);

    const allowed = VALID_TRANSITIONS[task.status];
    if (!allowed.includes(newStatus)) {
      throw new Error(`Invalid transition: ${task.status} → ${newStatus}`);
    }

    task.status = newStatus;
    task.updatedAt = Date.now();
  }

  assign(id: string, agentIds: string[]): void {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    task.assignedAgents = [...agentIds];
    task.updatedAt = Date.now();
  }

  setConsensusState(id: string, consensusState: Task['consensusState']): void {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    task.consensusState = consensusState;
    task.updatedAt = Date.now();
  }

  updateTokenEstimate(id: string, tokenEstimate: number): void {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    task.tokenEstimate = tokenEstimate;
    task.updatedAt = Date.now();
  }

  setSandbox(id: string, sandboxPath?: string, sandboxDiffStat?: string): void {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    task.sandboxPath = sandboxPath;
    task.sandboxDiffStat = sandboxDiffStat;
    task.updatedAt = Date.now();
  }

  update(id: string, patch: Partial<Task>): Task {
    const task = this.tasks.get(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    Object.assign(task, patch, { updatedAt: Date.now() });
    return { ...task };
  }

  list(status?: TaskStatus): Task[] {
    const all = Array.from(this.tasks.values());
    if (status) {
      return all.filter((t) => t.status === status).map((t) => ({ ...t }));
    }
    return all.map((t) => ({ ...t }));
  }
}
