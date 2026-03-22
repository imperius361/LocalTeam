import { expect, test } from '@playwright/test';

import { goToTeam, openWorkspace, selectObsidianTheme } from './support/helpers';
import {
  cleanupRuntimeRoot,
  createRuntimeRoot,
  launchLocalTeam,
} from './support/tauriHarness';

test.skip(process.platform !== 'win32', 'Functional suite requires Windows WebView2.');

test('applies the team and runs the session lifecycle end to end', async () => {
  const runtimeRoot = await createRuntimeRoot();
  const app = await launchLocalTeam({ scenario: 'session_ready', runtimeRoot });

  try {
    await selectObsidianTheme(app.mainPage);
    await openWorkspace(app.mainPage);
    await goToTeam(app.mainPage);

    await app.mainPage.getByTestId('team-apply').click();
    await expect(
      app.mainPage.getByText('Team bindings applied to the managed runtime.'),
    ).toBeVisible();

    await app.mainPage.getByTestId('team-session-action').click();
    await expect(app.mainPage.getByTestId('team-session-action')).toHaveText('Stop Session');
    await expect(app.mainPage.getByText('Session status: running')).toBeVisible();

    await app.mainPage.getByTestId('team-session-action').click();
    await expect(app.mainPage.getByTestId('team-session-action')).toHaveText('Start Session');
    await expect(app.mainPage.getByText('Session status: Not started')).toBeVisible();
    await expect(app.mainPage.getByText('Session returned to idle.')).toBeVisible();
  } finally {
    await app.close();
    await cleanupRuntimeRoot(runtimeRoot);
  }
});
