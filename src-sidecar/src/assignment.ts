import type { AgentConfig } from './types.js';

const STOP_WORDS = new Set([
  'and',
  'for',
  'the',
  'with',
  'from',
  'that',
  'this',
  'into',
  'your',
  'agent',
  'role',
]);

const ROLE_KEYWORD_RULES: Array<{ pattern: RegExp; keywords: string[] }> = [
  {
    pattern: /(architect|design|principal)/,
    keywords: ['architecture', 'design', 'system', 'tradeoff', 'plan', 'scalability'],
  },
  {
    pattern: /(engineer|developer|programmer|backend|frontend|fullstack)/,
    keywords: ['implement', 'build', 'code', 'feature', 'refactor', 'fix', 'api'],
  },
  {
    pattern: /(security|iam|auth|compliance)/,
    keywords: [
      'security',
      'auth',
      'authentication',
      'authorization',
      'rbac',
      'hardening',
      'policy',
      'secret',
      'vulnerability',
    ],
  },
  {
    pattern: /(qa|test|quality)/,
    keywords: ['test', 'qa', 'verification', 'validate', 'regression', 'coverage'],
  },
  {
    pattern: /(devops|platform|sre|operations|infra)/,
    keywords: ['deploy', 'pipeline', 'infrastructure', 'ci', 'cd', 'kubernetes', 'monitoring'],
  },
  {
    pattern: /(doc|writer)/,
    keywords: ['docs', 'documentation', 'readme', 'guide'],
  },
];

export interface AssignmentOptions {
  roleHint?: string;
  maxAgents?: number;
  fallbackAgentId?: string;
}

export function assignAgentsByRole(
  agents: AgentConfig[],
  title: string,
  description: string,
  options: AssignmentOptions = {},
): string[] {
  if (agents.length === 0) {
    return [];
  }

  const maxAgents = Math.max(1, Math.min(options.maxAgents ?? 2, agents.length));
  const taskText = normalize(`${title} ${description}`);
  const roleHint = normalize(options.roleHint ?? '');

  const scored = agents.map((agent) => ({
    agent,
    score: scoreAgent(agent, taskText, roleHint),
  }));

  scored.sort(
    (left, right) =>
      right.score - left.score || left.agent.id.localeCompare(right.agent.id),
  );

  const viable = scored.filter((entry) => entry.score > 0);
  if (viable.length === 0) {
    return [pickFallbackAgentId(agents, options.fallbackAgentId)];
  }

  const assigned = [viable[0].agent.id];
  if (maxAgents === 1 || viable.length === 1) {
    return assigned;
  }

  const threshold = Math.max(1, Math.floor(viable[0].score * 0.6));
  for (const candidate of viable.slice(1)) {
    if (assigned.length >= maxAgents) {
      break;
    }
    if (candidate.score >= threshold) {
      assigned.push(candidate.agent.id);
    }
  }

  return assigned;
}

function scoreAgent(agent: AgentConfig, taskText: string, roleHint: string): number {
  let score = 0;
  const role = normalize(agent.role);
  const agentId = normalize(agent.id);

  if (roleHint) {
    if (role.includes(roleHint) || agentId === roleHint) {
      score += 100;
    } else {
      const hintTokens = new Set(tokenize(roleHint));
      for (const token of tokenize(`${agent.role} ${agent.id}`)) {
        if (hintTokens.has(token)) {
          score += 20;
        }
      }
    }
  }

  for (const token of tokenize(`${agent.role} ${agent.id}`)) {
    if (taskText.includes(token)) {
      score += 12;
    }
  }

  for (const rule of ROLE_KEYWORD_RULES) {
    if (!rule.pattern.test(role)) {
      continue;
    }

    for (const keyword of rule.keywords) {
      if (taskText.includes(keyword)) {
        score += 4;
      }
    }
  }

  return score;
}

function pickFallbackAgentId(agents: AgentConfig[], fallbackAgentId?: string): string {
  if (fallbackAgentId && agents.some((agent) => agent.id === fallbackAgentId)) {
    return fallbackAgentId;
  }
  return [...agents].sort((left, right) => left.id.localeCompare(right.id))[0]!.id;
}

function tokenize(value: string): string[] {
  return normalize(value)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function normalize(value: string): string {
  return value.toLowerCase();
}
