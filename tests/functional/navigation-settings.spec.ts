import { expect, test } from '@playwright/test';

import { goToAgent, goToTeam, openWorkspace, selectObsidianTheme } from './support/helpers';
import {
  cleanupRuntimeRoot,
  createRuntimeRoot,
  launchLocalTeam,
} from './support/tauriHarness';

test.skip(process.platform !== 'win32', 'Functional suite requires Windows WebView2.');

test('navigates project to team to agent and back through breadcrumbs and sidebar state', async () => {
  const runtimeRoot = await createRuntimeRoot();
  const app = await launchLocalTeam({ scenario: 'session_ready', runtimeRoot });

  try {
    await selectObsidianTheme(app.mainPage);
    await openWorkspace(app.mainPage);
    await goToTeam(app.mainPage);

    await expect(app.mainPage.getByTestId('sidebar-team-ops-alpha')).toHaveAttribute(
      'aria-current',
      'page',
    );

    await goToAgent(app.mainPage);
    await expect(app.mainPage.getByText('Implementation Engineer')).toBeVisible();
    await expect(app.mainPage.getByText('Member Policy')).toBeVisible();
    await expect(app.mainPage.getByText('Session Activity')).toBeVisible();
    await expect(app.mainPage.getByTestId('sidebar-agent-implementer')).toHaveAttribute(
      'aria-current',
      'page',
    );

    await app.mainPage.getByTestId('breadcrumb-team-2').click();
    await expect(app.mainPage.getByTestId('team-view')).toBeVisible();

    await app.mainPage.getByTestId('breadcrumb-project-1').click();
    await expect(app.mainPage.getByTestId('project-view')).toBeVisible();
  } finally {
    await app.close();
    await cleanupRuntimeRoot(runtimeRoot);
  }
});

test('opens the settings window, completes runtime onboarding, and manages workspace selection', async () => {
  const runtimeRoot = await createRuntimeRoot();
  const app = await launchLocalTeam({ scenario: 'empty_state', runtimeRoot });

  try {
    await selectObsidianTheme(app.mainPage);

    await app.mainPage.getByTestId('topbar-settings').click();
    const settingsPage = await app.waitForPageByTestId('settings-window');

    await expect(settingsPage.getByText('LocalTeam Runtime Settings')).toBeVisible();
    await expect(settingsPage.getByText('Project Settings')).toBeVisible();
    await expect(settingsPage.getByTestId('settings-runtime-action')).toHaveText(
      'Initialize Runtime',
    );

    await settingsPage.getByTestId('settings-runtime-action').click();
    await expect(settingsPage.getByText('Gateway online')).toBeVisible();

    await settingsPage.getByTestId('settings-choose-workspace').click();
    await expect(settingsPage.getByText(app.workspace)).toBeVisible();

    await settingsPage.getByTestId('settings-reload-workspace').click();
    await expect(settingsPage.getByText('Operations Alpha')).toBeVisible();
    await expect(settingsPage.getByText('3 members')).toBeVisible();
  } finally {
    await app.close();
    await cleanupRuntimeRoot(runtimeRoot);
  }
});
