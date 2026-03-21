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

import { AppWindowContent } from '../../src/App';

function makeSnapshot(): ProjectSnapshot {
  return {
    version: 'v1',
    projectRoot: 'C:\\Repositories\\LocalTeam',
    config: {
      team: {
        name: 'LocalTeam',
        agents: [
          {
            id: 'architect',
            role: 'Architect',
            model: 'gpt-4.1-mini',
            provider: 'openai',
            systemPrompt: 'Plan work.',
          },
        ],
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
    credentials: [
      { provider: 'openai', hasKey: true },
      { provider: 'anthropic', hasKey: false },
    ],
    templates: [],
    commandApprovals: [],
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

    expect(markup).toContain('LocalTeam Settings');
    expect(markup).toContain('Project Settings');
    expect(markup).toContain('Provider keys');
    expect(markup).not.toContain('Running Tasks');
  });
});
