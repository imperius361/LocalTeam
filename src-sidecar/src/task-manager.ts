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

  create(title: string, description: string): Task {
    const now = Date.now();
    const task: Task = {
      id: randomUUID(),
      title,
      description,
      status: 'pending',
      assignedAgents: [],
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(task.id, task);
    return { ...task };
  }

  createSubtask(parentId: string, title: string, description: string): Task {
    const task = this.create(title, description);
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
      throw new Error(
        `Invalid transition: ${task.status} → ${newStatus}`,
      );
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

  list(status?: TaskStatus): Task[] {
    const all = Array.from(this.tasks.values());
    if (status) {
      return all.filter((t) => t.status === status).map((t) => ({ ...t }));
    }
    return all.map((t) => ({ ...t }));
  }
}
