import type { AgentConfig, Task } from './types.js';

const MAX_SUBTASKS = 5;

export interface ProposedSubtask {
  title: string;
  description: string;
  roleHint?: string;
}

export function selectLeadAgent(agents: AgentConfig[]): AgentConfig | undefined {
  if (agents.length === 0) {
    return undefined;
  }

  const byRole = agents.find((agent) =>
    /(architect|lead|principal)/i.test(agent.role),
  );
  if (byRole) {
    return byRole;
  }

  return agents[0];
}

export function buildDecompositionPrompt(
  task: Task,
  agents: AgentConfig[],
): string {
  const roster = agents
    .map((agent) => `- ${agent.role} (${agent.id})`)
    .join('\n');

  return [
    'You are the lead planner for this task.',
    `Root task: ${task.title}`,
    `Description: ${task.description}`,
    'Break this into 2 to 5 practical subtasks for implementation.',
    'Return JSON only in this exact shape:',
    '{"subtasks":[{"title":"...","description":"...","roleHint":"..."}]}',
    'roleHint should reference the most relevant team role for each subtask.',
    'Each subtask must be specific and execution-ready.',
    `Team roles:\n${roster}`,
  ].join('\n\n');
}

export function deriveSubtasksFromLeadOutput(
  task: Task,
  agents: AgentConfig[],
  leadOutput: string,
): ProposedSubtask[] {
  const parsed = parseSubtasksFromJson(leadOutput);
  if (parsed.length > 0) {
    return parsed;
  }
  return buildFallbackSubtasks(task, agents);
}

function parseSubtasksFromJson(raw: string): ProposedSubtask[] {
  const candidates = [raw.trim(), extractJsonObject(raw), extractJsonArray(raw)].filter(
    (value): value is string => Boolean(value),
  );

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      const subtasks = extractSubtasks(parsed);
      if (subtasks.length > 0) {
        return subtasks.slice(0, MAX_SUBTASKS);
      }
    } catch {
      continue;
    }
  }

  return [];
}

function extractSubtasks(parsed: unknown): ProposedSubtask[] {
  if (Array.isArray(parsed)) {
    return normalizeSubtasks(parsed);
  }
  if (!parsed || typeof parsed !== 'object') {
    return [];
  }

  const asRecord = parsed as Record<string, unknown>;
  const list = asRecord.subtasks;
  if (!Array.isArray(list)) {
    return [];
  }
  return normalizeSubtasks(list);
}

function normalizeSubtasks(raw: unknown[]): ProposedSubtask[] {
  const unique = new Set<string>();
  const subtasks: ProposedSubtask[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const item = entry as Record<string, unknown>;
    const title = typeof item.title === 'string' ? item.title.trim() : '';
    const description =
      typeof item.description === 'string' ? item.description.trim() : '';
    const roleHint = typeof item.roleHint === 'string' ? item.roleHint.trim() : '';

    if (!title || !description) {
      continue;
    }

    const dedupeKey = title.toLowerCase();
    if (unique.has(dedupeKey)) {
      continue;
    }

    unique.add(dedupeKey);
    subtasks.push({
      title: limitLength(title, 120),
      description: limitLength(description, 280),
      roleHint: roleHint ? limitLength(roleHint, 80) : undefined,
    });

    if (subtasks.length >= MAX_SUBTASKS) {
      break;
    }
  }

  return subtasks;
}

function buildFallbackSubtasks(
  task: Task,
  agents: AgentConfig[],
): ProposedSubtask[] {
  const planningRole = findRoleHint(agents, /(architect|lead|principal|analyst)/i);
  const implementationRole = findRoleHint(
    agents,
    /(engineer|developer|backend|frontend|platform|devops)/i,
  );
  const validationRole = findRoleHint(
    agents,
    /(security|qa|test|review|sre|operations)/i,
  );

  return [
    {
      title: `Scope ${task.title}`,
      description: `Define acceptance criteria, dependencies, and delivery steps for "${task.title}".`,
      roleHint: planningRole ?? implementationRole,
    },
    {
      title: `Implement ${task.title}`,
      description: `Deliver the core implementation for "${task.title}" with concise notes on key tradeoffs.`,
      roleHint: implementationRole ?? planningRole,
    },
    {
      title: `Validate ${task.title}`,
      description: `Verify correctness, security posture, and operational readiness for "${task.title}".`,
      roleHint: validationRole ?? implementationRole ?? planningRole,
    },
  ];
}

function findRoleHint(
  agents: AgentConfig[],
  pattern: RegExp,
): string | undefined {
  const match = agents.find((agent) => pattern.test(agent.role));
  return match?.role;
}

function extractJsonObject(raw: string): string | undefined {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) {
    return undefined;
  }
  return raw.slice(start, end + 1);
}

function extractJsonArray(raw: string): string | undefined {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end <= start) {
    return undefined;
  }
  return raw.slice(start, end + 1);
}

function limitLength(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 3).trimEnd()}...` : value;
}
