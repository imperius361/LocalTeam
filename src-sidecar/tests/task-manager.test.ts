import { describe, it, expect } from 'vitest';
import { TaskManager } from '../src/task-manager';

describe('TaskManager', () => {
  it('creates a task with pending status', () => {
    const manager = new TaskManager();
    const task = manager.create('Build auth', 'Implement OAuth2 login');

    expect(task.title).toBe('Build auth');
    expect(task.description).toBe('Implement OAuth2 login');
    expect(task.status).toBe('pending');
    expect(task.id).toBeTruthy();
    expect(task.assignedAgents).toEqual([]);
  });

  it('retrieves a task by id', () => {
    const manager = new TaskManager();
    const task = manager.create('Task 1', 'Description 1');

    const found = manager.get(task.id);
    expect(found).toEqual(task);
  });

  it('returns undefined for unknown task id', () => {
    const manager = new TaskManager();
    expect(manager.get('nonexistent')).toBeUndefined();
  });

  it('transitions task through valid states', () => {
    const manager = new TaskManager();
    const task = manager.create('Task', 'Desc');

    manager.transition(task.id, 'in_progress');
    expect(manager.get(task.id)!.status).toBe('in_progress');

    manager.transition(task.id, 'review');
    expect(manager.get(task.id)!.status).toBe('review');

    manager.transition(task.id, 'completed');
    expect(manager.get(task.id)!.status).toBe('completed');
  });

  it('rejects invalid state transitions', () => {
    const manager = new TaskManager();
    const task = manager.create('Task', 'Desc');

    // Cannot go from pending directly to completed
    expect(() => manager.transition(task.id, 'completed')).toThrow(
      'Invalid transition',
    );
  });

  it('assigns agents to a task', () => {
    const manager = new TaskManager();
    const task = manager.create('Task', 'Desc');

    manager.assign(task.id, ['architect', 'engineer']);
    expect(manager.get(task.id)!.assignedAgents).toEqual([
      'architect',
      'engineer',
    ]);
  });

  it('creates subtasks linked to a parent', () => {
    const manager = new TaskManager();
    const parent = manager.create('Parent', 'Parent desc');
    const child = manager.createSubtask(parent.id, 'Child', 'Child desc');

    expect(child.parentTaskId).toBe(parent.id);
  });

  it('lists all tasks', () => {
    const manager = new TaskManager();
    manager.create('A', 'a');
    manager.create('B', 'b');

    expect(manager.list()).toHaveLength(2);
  });

  it('lists tasks filtered by status', () => {
    const manager = new TaskManager();
    const t1 = manager.create('A', 'a');
    manager.create('B', 'b');
    manager.transition(t1.id, 'in_progress');

    expect(manager.list('in_progress')).toHaveLength(1);
    expect(manager.list('pending')).toHaveLength(1);
  });
});
