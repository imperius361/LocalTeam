import { expect, test } from '@playwright/test';

import { openWorkspace, selectObsidianTheme } from './support/helpers';
import {
  cleanupRuntimeRoot,
  createRuntimeRoot,
  launchLocalTeam,
} from './support/tauriHarness';

test.skip(process.platform !== 'win32', 'Functional suite requires Windows WebView2.');

test('persists the selected theme across app relaunches', async () => {
  const runtimeRoot = await createRuntimeRoot();
  let app = await launchLocalTeam({ scenario: 'empty_state', runtimeRoot });

  try {
    await expect(app.mainPage.getByTestId('theme-selector')).toBeVisible();
    await app.mainPage.getByTestId('theme-card-obsidian').click();
    await expect(app.mainPage.getByTestId('global-view')).toBeVisible();
    await expect(app.mainPage.locator('html')).toHaveAttribute('data-theme', 'obsidian');
  } finally {
    await app.close();
  }

  app = await launchLocalTeam({ scenario: 'empty_state', runtimeRoot });

  try {
    await expect(app.mainPage.getByTestId('theme-selector')).toHaveCount(0);
    await expect(app.mainPage.getByTestId('global-view')).toBeVisible();
    await expect(app.mainPage.locator('html')).toHaveAttribute('data-theme', 'obsidian');
    expect(await app.mainPage.evaluate(() => localStorage.getItem('localteam.theme'))).toBe(
      'obsidian',
    );
  } finally {
    await app.close();
    await cleanupRuntimeRoot(runtimeRoot);
  }
});

test('opens a workspace, navigates to the project view, and records a recent project', async () => {
  const runtimeRoot = await createRuntimeRoot();
  const app = await launchLocalTeam({ scenario: 'empty_state', runtimeRoot });

  try {
    await selectObsidianTheme(app.mainPage);
    await openWorkspace(app.mainPage);

    await expect(app.mainPage.getByText(`Project path: ${app.workspace}`)).toBeVisible();

    await app.mainPage.getByTestId('breadcrumb-global-0').click();
    await expect(app.mainPage.getByRole('button', { name: /Operations Alpha/i })).toBeVisible();

    const recents = await app.mainPage.evaluate(() => localStorage.getItem('localteam.recents'));
    expect(recents).toContain('Operations Alpha');
  } finally {
    await app.close();
    await cleanupRuntimeRoot(runtimeRoot);
  }
});
