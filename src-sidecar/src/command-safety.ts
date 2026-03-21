import { relative, resolve } from 'node:path';
import type {
  AgentConfig,
  CommandExecutionRequest,
  ProjectConfig,
  Task,
} from './types.js';

export interface CommandPolicyInput {
  projectRoot: string;
  config: ProjectConfig;
  task: Task;
  agent: AgentConfig;
  request: CommandExecutionRequest;
}

export interface CommandPolicyResult {
  allowed: boolean;
  requiresApproval: boolean;
  preApproved: boolean;
  reason?: string;
  effectiveCwd: string;
  sandboxMode: ProjectConfig['sandbox']['defaultMode'];
  checkedPaths: string[];
  matchedDenyRule?: string;
  allowedPaths: string[];
}

export function evaluateCommandPolicy(input: CommandPolicyInput): CommandPolicyResult {
  const { projectRoot, config, task, agent, request } = input;

  const baseResult: Omit<CommandPolicyResult, 'allowed' | 'requiresApproval' | 'preApproved'> = {
    reason: undefined,
    effectiveCwd: '',
    sandboxMode: config.sandbox.defaultMode,
    checkedPaths: [],
    matchedDenyRule: undefined,
    allowedPaths: [...(agent.allowedPaths ?? [])],
  };

  if (!agent.canExecuteCommands) {
    return deny(
      baseResult,
      'Agent is not allowed to execute commands by canExecuteCommands policy.',
    );
  }

  const sandboxRoot = resolveSandboxRoot(projectRoot, config, task);
  if (!sandboxRoot) {
    return deny(
      baseResult,
      'Task has no sandbox path while sandbox.defaultMode is worktree.',
    );
  }

  const effectiveCwd = resolve(
    sandboxRoot,
    request.cwd && request.cwd.trim() ? request.cwd : '.',
  );
  baseResult.effectiveCwd = effectiveCwd;
  baseResult.checkedPaths.push(effectiveCwd);

  if (!isWithinPath(sandboxRoot, effectiveCwd)) {
    return deny(baseResult, `Command cwd escapes sandbox root: ${effectiveCwd}`);
  }

  const cwdRelative = toProjectRelative(sandboxRoot, effectiveCwd);
  if (!cwdRelative) {
    return deny(baseResult, `Unable to resolve command cwd relative path: ${effectiveCwd}`);
  }

  const cwdDenied = matchDenyList(cwdRelative, config.fileAccess.denyList);
  if (cwdDenied) {
    return deny(baseResult, `Command cwd is denied by fileAccess.denyList: ${cwdDenied}`, cwdDenied);
  }

  const allowedRoots = resolveAllowedRoots(sandboxRoot, agent.allowedPaths);
  if (allowedRoots.length > 0 && !allowedRoots.some((root) => isWithinPath(root, effectiveCwd))) {
    return deny(baseResult, 'Command cwd is outside agent.allowedPaths.');
  }

  const candidatePaths = extractPathCandidates(request.command, effectiveCwd);
  for (const candidatePath of candidatePaths) {
    baseResult.checkedPaths.push(candidatePath);
    if (!isWithinPath(sandboxRoot, candidatePath)) {
      return deny(baseResult, `Command path escapes sandbox root: ${candidatePath}`);
    }

    const relativePath = toProjectRelative(sandboxRoot, candidatePath);
    if (!relativePath) {
      return deny(baseResult, `Unable to resolve command path: ${candidatePath}`);
    }

    const denied = matchDenyList(relativePath, config.fileAccess.denyList);
    if (denied) {
      return deny(
        baseResult,
        `Command references denied path (${relativePath}) via rule: ${denied}`,
        denied,
      );
    }

    if (allowedRoots.length > 0 && !allowedRoots.some((root) => isWithinPath(root, candidatePath))) {
      return deny(
        baseResult,
        `Command path is outside agent.allowedPaths: ${relativePath}`,
      );
    }
  }

  const preApproved = isCommandPreApproved(request.command, agent.preApprovedCommands ?? []);
  return {
    ...baseResult,
    allowed: true,
    preApproved,
    requiresApproval: !preApproved,
  };
}

function resolveSandboxRoot(
  projectRoot: string,
  config: ProjectConfig,
  task: Task,
): string | undefined {
  if (config.sandbox.defaultMode === 'worktree') {
    return task.sandboxPath ? resolve(task.sandboxPath) : undefined;
  }
  return resolve(projectRoot);
}

function resolveAllowedRoots(projectRoot: string, allowedPaths?: string[]): string[] {
  if (!allowedPaths || allowedPaths.length === 0) {
    return [];
  }
  return allowedPaths.map((path) => resolve(projectRoot, path));
}

function isWithinPath(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !rel.includes(`..${pathSeparator()}`));
}

function pathSeparator(): string {
  return process.platform === 'win32' ? '\\' : '/';
}

function toProjectRelative(projectRoot: string, targetPath: string): string | undefined {
  const rel = relative(projectRoot, targetPath);
  if (rel.startsWith('..')) {
    return undefined;
  }
  return normalizePath(rel || '.');
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '');
}

function deny(
  base: Omit<CommandPolicyResult, 'allowed' | 'requiresApproval' | 'preApproved'>,
  reason: string,
  matchedDenyRule?: string,
): CommandPolicyResult {
  return {
    ...base,
    allowed: false,
    requiresApproval: false,
    preApproved: false,
    reason,
    matchedDenyRule,
  };
}

function extractPathCandidates(command: string, cwd: string): string[] {
  const tokens = command.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? [];
  const paths = new Set<string>();

  for (const token of tokens) {
    if (!token || token.startsWith('-')) {
      continue;
    }

    const normalized = token.replace(/^['"]|['"]$/g, '').trim();
    if (!normalized) {
      continue;
    }

    if (!looksLikePath(normalized)) {
      continue;
    }

    paths.add(resolve(cwd, normalized));
  }

  return Array.from(paths);
}

function looksLikePath(token: string): boolean {
  if (token.startsWith('$')) {
    return false;
  }
  return (
    token.includes('/') ||
    token.includes('\\') ||
    token.startsWith('.') ||
    token.endsWith('.env') ||
    token.endsWith('.json') ||
    token.endsWith('.yaml') ||
    token.endsWith('.yml') ||
    token.endsWith('.toml')
  );
}

function matchDenyList(relativePath: string, denyList: string[]): string | undefined {
  for (const pattern of denyList) {
    if (matchesPathPattern(relativePath, pattern)) {
      return pattern;
    }
  }
  return undefined;
}

function matchesPathPattern(relativePath: string, pattern: string): boolean {
  const candidate = normalizePath(relativePath);
  const normalizedPattern = normalizePath(pattern);

  if (!normalizedPattern) {
    return false;
  }

  if (normalizedPattern.endsWith('/')) {
    const prefix = normalizedPattern.slice(0, -1);
    return candidate === prefix || candidate.startsWith(`${prefix}/`);
  }

  if (!normalizedPattern.includes('/') && !normalizedPattern.includes('*')) {
    const basename = candidate.split('/').at(-1);
    return basename === normalizedPattern;
  }

  const wildcardRegex = new RegExp(
    `^${escapeRegExp(normalizedPattern).replace(/\\\*/g, '.*')}$`,
  );
  return wildcardRegex.test(candidate);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isCommandPreApproved(command: string, preApproved: string[]): boolean {
  if (preApproved.length === 0) {
    return false;
  }

  const normalizedCommand = command.trim().toLowerCase();
  const commandName = normalizedCommand.split(/\s+/)[0] ?? '';

  for (const entry of preApproved) {
    const normalizedEntry = entry.trim().toLowerCase();
    if (!normalizedEntry) {
      continue;
    }

    if (normalizedEntry.includes(' ')) {
      if (
        normalizedCommand === normalizedEntry ||
        normalizedCommand.startsWith(`${normalizedEntry} `)
      ) {
        return true;
      }
      continue;
    }

    if (commandName === normalizedEntry) {
      return true;
    }
  }

  return false;
}
