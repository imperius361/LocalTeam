import type { ProjectSnapshot, RecentProject } from './contracts';

interface WorkspaceLoadDependencies {
  loadProjectSnapshot: (rootPath?: string) => Promise<ProjectSnapshot>;
  setSnapshot: (snapshot: ProjectSnapshot) => void;
  setActiveProjectPath: (path: string | null) => void;
  addRecentProject: (project: RecentProject) => void;
}

export function normalizeWorkspaceSelection(selection: string): string {
  const trimmed = selection.trim().replace(/[\\/]+$/, '');
  if (!trimmed) {
    return '';
  }

  if (/[\\/]localteam\.json$/i.test(trimmed)) {
    return trimmed.replace(/[\\/]localteam\.json$/i, '');
  }

  return trimmed;
}

export function createRecentProjectEntry(
  snapshot: ProjectSnapshot,
  openedAt = Date.now(),
): RecentProject | null {
  if (!snapshot.projectRoot) {
    return null;
  }

  return {
    path: snapshot.projectRoot,
    name: getProjectDisplayName(snapshot) ?? snapshot.projectRoot,
    lastOpenedAt: openedAt,
  };
}

export function createOfflineSnapshot(detail?: string): ProjectSnapshot {
  return {
    version: 'v1',
    projectRoot: null,
    config: null,
    session: null,
    tasks: [],
    messages: [],
    consensus: [],
    agentStatuses: [],
    credentials: [],
    templates: [],
    commandApprovals: [],
    gateway: {
      ready: false,
      onboardingCompleted: false,
      profileCount: 0,
      workspaceRoot: null,
    },
    runtimeProfiles: [],
    sessions: [],
    approvals: [],
    activeTeamId: null,
    sidecar: {
      ready: false,
      version: 'offline',
      uptime: 0,
      ...(detail ? { lastError: detail } : {}),
    },
  };
}

export function formatWorkspaceError(
  error: unknown,
  fallback = 'Workspace operation failed.',
): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  return fallback;
}

export async function loadAndStoreWorkspace(
  rootPath: string,
  dependencies: WorkspaceLoadDependencies,
): Promise<ProjectSnapshot> {
  const normalizedRoot = normalizeWorkspaceSelection(rootPath);
  if (!normalizedRoot) {
    throw new Error('Workspace path is required.');
  }

  const snapshot = await dependencies.loadProjectSnapshot(normalizedRoot);
  dependencies.setSnapshot(snapshot);
  dependencies.setActiveProjectPath(snapshot.projectRoot);

  const recentProject = createRecentProjectEntry(snapshot);
  if (recentProject) {
    dependencies.addRecentProject(recentProject);
  }

  return snapshot;
}

function getProjectDisplayName(snapshot: ProjectSnapshot): string | null {
  const config = snapshot.config;
  if (!config) {
    return null;
  }

  const defaultTeam = config.defaultTeamId
    ? config.teams.find((team) => team.id === config.defaultTeamId)
    : null;
  return defaultTeam?.name ?? config.teams[0]?.name ?? null;
}
