import { describe, expect, it } from 'vitest';
import {
  buildDecompositionPrompt,
  deriveSubtasksFromLeadOutput,
  selectLeadAgent,
} from '../src/decomposition';
import type { AgentConfig, Task } from '../src/types';

const agents: AgentConfig[] = [
  {
    id: 'eng',
    role: 'Backend Engineer',
    model: 'mock',
    provider: 'mock',
    systemPrompt: 'Build features.',
  },
  {
    id: 'arch',
    role: 'Software Architect',
    model: 'mock',
    provider: 'mock',
    systemPrompt: 'Design systems.',
  },
];

const task: Task = {
  id: 'task-1',
  title: 'Add authentication',
  description: 'Implement login with secure token validation and docs.',
  status: 'pending',
  assignedAgents: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
  tokenEstimate: 0,
};

describe('decomposition utilities', () => {
  it('selects architect as lead agent when available', () => {
    const lead = selectLeadAgent(agents);
    expect(lead?.id).toBe('arch');
  });

  it('builds a decomposition prompt with task context', () => {
    const prompt = buildDecompositionPrompt(task, agents);
    expect(prompt).toContain('Root task: Add authentication');
    expect(prompt).toContain('JSON only');
    expect(prompt).toContain('Software Architect');
  });

  it('parses JSON subtasks from lead output', () => {
    const subtasks = deriveSubtasksFromLeadOutput(
      task,
      agents,
      JSON.stringify({
        subtasks: [
          {
            title: 'Design auth flow',
            description: 'Define session and token lifecycle.',
            roleHint: 'Software Architect',
          },
          {
            title: 'Implement auth endpoints',
            description: 'Add login/logout endpoints and middleware checks.',
            roleHint: 'Backend Engineer',
          },
        ],
      }),
    );

    expect(subtasks).toHaveLength(2);
    expect(subtasks[0].title).toBe('Design auth flow');
    expect(subtasks[1].roleHint).toBe('Backend Engineer');
  });

  it('falls back to practical subtasks when lead output is not parseable JSON', () => {
    const subtasks = deriveSubtasksFromLeadOutput(
      task,
      agents,
      'OBJECTION: waiting for provider credentials.',
    );

    expect(subtasks).toHaveLength(3);
    expect(subtasks[0].title).toContain('Scope');
    expect(subtasks[1].title).toContain('Implement');
    expect(subtasks[2].title).toContain('Validate');
  });
});
