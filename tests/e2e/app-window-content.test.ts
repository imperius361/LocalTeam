import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ProjectSnapshot } from '../../src/lib/contracts';
import { useAppStore } from '../../src/store/appStore';

const { isSettingsWindow } = vi.hoisted(() => ({
  isSettingsWindow: vi.fn(() => true),
}));

vi.mock('../../src/lib/ipc', () => ({
  closeCurrentWindow: vi.fn(async () => {}),
  getStatusSnapshot: vi.fn(async () => ({})),
  initIpc: vi.fn(async () => {}),
  isSettingsWindow,
  loadProjectSnapshot: vi.fn(async () => ({})),
  openSettingsWindow: vi.fn(async () => {}),
  pickProjectFolder: vi.fn(async () => null),
  subscribeToNotifications: vi.fn(() => () => {}),
  subscribeToWorkspaceSelections: vi.fn(async () => () => {}),
}));

vi.mock('../../src/lib/nemoclaw', () => ({
  getNemoclawRuntimeStatus: vi.fn(async () => ({
    onboardingCompleted: true,
    profiles: [],
  })),
  launchNemoclawOnboarding: vi.fn(async () => ({
    onboardingCompleted: true,
    profiles: [],
  })),
}));

import { AppWindowContent } from '../../src/App';

function makeSnapshot(): ProjectSnapshot {
  return {
    version: 'v1',
    projectRoot: 'C:\\Repositories\\LocalTeam',
    config: {
      version: 2,
      defaultTeamId: 'localteam',
      teams: [
        {
          id: 'localteam',
          name: 'LocalTeam',
          workspaceMode: 'shared_project',
          members: [
            {
              id: 'architect',
              role: 'Architect',
              runtimeProfileRef: 'profiles/openai-architect',
              runtimeHint: {
                provider: 'nemoclaw',
                model: 'openclaw-local',
              },
              systemPrompt: 'Plan work.',
            },
          ],
        },
      ],
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
    gateway: {
      ready: true,
      onboardingCompleted: true,
      profileCount: 1,
      workspaceRoot: 'C:\\Repositories\\LocalTeam',
    },
    runtimeProfiles: [
      {
        id: 'profiles/openai-architect',
        label: 'Architect Profile',
        provider: 'nemoclaw',
        model: 'openclaw-local',
        availability: 'ready',
      },
    ],
    sessions: [],
    approvals: [],
    activeTeamId: 'localteam',
    sidecar: {
      ready: true,
      version: '0.2.0',
      uptime: 1_000,
    },
  };
}

afterEach(() => {
  useAppStore.getState().setSnapshot({
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
    },
  });
});

describe('App window routing', () => {
  it('renders the dedicated settings surface in the settings window', () => {
    useAppStore.getState().setSnapshot(makeSnapshot());

    const markup = renderToStaticMarkup(createElement(AppWindowContent));

    expect(markup).toContain('LocalTeam Runtime Settings');
    expect(markup).toContain('Project Settings');
    expect(markup).toContain('Managed Runtime');
    expect(markup).toContain('Runtime Profile Bindings');
    expect(markup).not.toContain('Running Tasks');
  });
});
