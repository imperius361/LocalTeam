import { describe, expect, it } from 'vitest';
import { assignAgentsByRole } from '../src/assignment';
import type { AgentConfig } from '../src/types';

const agents: AgentConfig[] = [
  {
    id: 'architect',
    role: 'Software Architect',
    model: 'mock',
    provider: 'mock',
    systemPrompt: 'Plan systems.',
  },
  {
    id: 'security',
    role: 'Security Engineer',
    model: 'mock',
    provider: 'mock',
    systemPrompt: 'Secure systems.',
  },
  {
    id: 'engineer',
    role: 'Backend Engineer',
    model: 'mock',
    provider: 'mock',
    systemPrompt: 'Build systems.',
  },
];

describe('assignAgentsByRole', () => {
  it('assigns relevant agents instead of the full team', () => {
    const assigned = assignAgentsByRole(
      agents,
      'Harden authentication',
      'Implement RBAC and strengthen security policy checks.',
      { maxAgents: 2 },
    );

    expect(assigned).toContain('security');
    expect(assigned.length).toBeLessThan(agents.length);
  });

  it('prioritizes an explicit role hint', () => {
    const assigned = assignAgentsByRole(
      agents,
      'Add API endpoint',
      'Implement endpoint and tests.',
      { roleHint: 'Security Engineer', maxAgents: 1 },
    );

    expect(assigned).toEqual(['security']);
  });

  it('uses fallback when no role matches are found', () => {
    const assigned = assignAgentsByRole(
      agents,
      'Do something generic',
      'No obvious specialization keywords are present.',
      { maxAgents: 1, fallbackAgentId: 'architect' },
    );

    expect(assigned).toEqual(['architect']);
  });
});
