import type { Task } from './contracts';

export interface TaskTreeRow {
  task: Task;
  depth: number;
  parentTask: Task | null;
}

export function isAgentSubtask(task: Task): boolean {
  return task.origin === 'agent_subtask' || Boolean(task.parentTaskId);
}

export function isTopLevelRequestTask(task: Task): boolean {
  return task.origin === 'user_request' && !task.parentTaskId;
}

export function getTopLevelRequestTasks(tasks: Task[]): Task[] {
  return tasks
    .filter(isTopLevelRequestTask)
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export function getChildTasks(tasks: Task[], parentTaskId: string): Task[] {
  return tasks
    .filter((task) => task.parentTaskId === parentTaskId)
    .sort((left, right) => left.createdAt - right.createdAt);
}

export function buildTaskTreeRows(tasks: Task[]): TaskTreeRow[] {
  const rows: TaskTreeRow[] = [];
  const childrenByParent = new Map<string, Task[]>();

  for (const task of tasks) {
    if (!task.parentTaskId) {
      continue;
    }

    const current = childrenByParent.get(task.parentTaskId) ?? [];
    current.push(task);
    childrenByParent.set(task.parentTaskId, current);
  }

  for (const childEntries of childrenByParent.values()) {
    childEntries.sort((left, right) => left.createdAt - right.createdAt);
  }

  const roots = getTopLevelRequestTasks(tasks);
  for (const root of roots) {
    rows.push({ task: root, depth: 0, parentTask: null });
    const children = childrenByParent.get(root.id) ?? [];
    for (const child of children) {
      rows.push({ task: child, depth: 1, parentTask: root });
    }
  }

  return rows;
}

export function countActiveRequestTasks(tasks: Task[]): number {
  return getTopLevelRequestTasks(tasks).filter((task) => task.status === 'in_progress').length;
}
