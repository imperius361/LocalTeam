import { describe, expect, it, vi } from 'vitest';

import type { ProjectSnapshot } from '../../src/lib/contracts';
import { createOfflineSnapshot, createRecentProjectEntry, loadAndStoreWorkspace, normalizeWorkspaceSelection } from '../../src/lib/workspace';

function makeSnapshot(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
  return {
    version: 'v1',
    projectRoot: 'C:\\Repositories\\LocalTeam',
    config: {
      team: {
        name: 'LocalTeam',
        agents: [],
      },
      consensus: {
        maxRounds: 3,
        requiredMajority: 0.66,
      },
      sandbox: {
        defaultMode: 'worktree',
        useWorktrees: true,
      },
      fileAccess: {
        denyList: ['.env'],
      },
    },
    session: null,
    tasks: [],
    messages: [],
    consensus: [],
    agentStatuses: [],
    credentials: [],
    templates: [],
    commandApprovals: [],
    sidecar: {
      ready: true,
      version: '0.2.0',
      uptime: 1_000,
    },
    ...overrides,
  };
}

describe('workspace helpers', () => {
  it('normalizes legacy localteam.json selections to the parent repo folder', () => {
    expect(
      normalizeWorkspaceSelection('C:\\Repositories\\LocalTeam\\localteam.json'),
    ).toBe('C:\\Repositories\\LocalTeam');
    expect(
      normalizeWorkspaceSelection('/repos/localteam/localteam.json'),
    ).toBe('/repos/localteam');
  });

  it('loads a workspace snapshot and updates recents + active project path', async () => {
    const snapshot = makeSnapshot();
    const loadProjectSnapshot = vi.fn(async () => snapshot);
    const setSnapshot = vi.fn();
    const setActiveProjectPath = vi.fn();
    const addRecentProject = vi.fn();

    const loaded = await loadAndStoreWorkspace('C:\\Repositories\\LocalTeam', {
      loadProjectSnapshot,
      setSnapshot,
      setActiveProjectPath,
      addRecentProject,
    });

    expect(loaded).toBe(snapshot);
    expect(loadProjectSnapshot).toHaveBeenCalledWith('C:\\Repositories\\LocalTeam');
    expect(setSnapshot).toHaveBeenCalledWith(snapshot);
    expect(setActiveProjectPath).toHaveBeenCalledWith('C:\\Repositories\\LocalTeam');
    expect(addRecentProject).toHaveBeenCalledWith({
      path: 'C:\\Repositories\\LocalTeam',
      name: 'LocalTeam',
      lastOpenedAt: expect.any(Number),
    });
  });

  it('uses the same loader for legacy localteam.json selections', async () => {
    const snapshot = makeSnapshot();
    const loadProjectSnapshot = vi.fn(async () => snapshot);

    await loadAndStoreWorkspace('C:\\Repositories\\LocalTeam\\localteam.json', {
      loadProjectSnapshot,
      setSnapshot: vi.fn(),
      setActiveProjectPath: vi.fn(),
      addRecentProject: vi.fn(),
    });

    expect(loadProjectSnapshot).toHaveBeenCalledWith('C:\\Repositories\\LocalTeam');
  });

  it('creates recent entries from the resolved workspace root', () => {
    const recent = createRecentProjectEntry(makeSnapshot(), 1234);
    expect(recent).toEqual({
      path: 'C:\\Repositories\\LocalTeam',
      name: 'LocalTeam',
      lastOpenedAt: 1234,
    });
  });

  it('builds an offline snapshot model when the sidecar disconnects', () => {
    expect(createOfflineSnapshot('Sidecar terminated')).toEqual({
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
      sidecar: {
        ready: false,
        version: 'offline',
        uptime: 0,
        lastError: 'Sidecar terminated',
      },
    });
  });
});
