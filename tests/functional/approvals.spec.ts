import { expect, test } from '@playwright/test';

import { goToAgent, goToTeam, openWorkspace, selectObsidianTheme } from './support/helpers';
import {
  cleanupRuntimeRoot,
  createRuntimeRoot,
  launchLocalTeam,
} from './support/tauriHarness';

test.skip(process.platform !== 'win32', 'Functional suite requires Windows WebView2.');

test('shows pending approvals across global, team, and agent views and approves them', async () => {
  const runtimeRoot = await createRuntimeRoot();
  const app = await launchLocalTeam({ scenario: 'pending_approval', runtimeRoot });

  try {
    await selectObsidianTheme(app.mainPage);
    await openWorkspace(app.mainPage);

    await app.mainPage.getByTestId('breadcrumb-global-0').click();
    await expect(app.mainPage.getByTestId('global-alerts')).toContainText('command approval');

    await app.mainPage.getByRole('button', { name: /Operations Alpha/i }).click();
    await goToTeam(app.mainPage);
    await expect(app.mainPage.getByTestId('command-approvals-panel')).toContainText(
      'git status --short',
    );

    await goToAgent(app.mainPage);
    await expect(app.mainPage.getByText('No pending approvals for this member.')).toHaveCount(0);
    await expect(app.mainPage.getByText('git status --short')).toBeVisible();

    await app.mainPage
      .getByTestId('agent-approval-approve-approval-implementer-status')
      .click();

    await expect(app.mainPage.getByText('No pending approvals for this member.')).toBeVisible();
    await expect(app.mainPage.getByText('approved • exit 0')).toBeVisible();
  } finally {
    await app.close();
    await cleanupRuntimeRoot(runtimeRoot);
  }
});

test('denies a pending approval and records the denied state', async () => {
  const runtimeRoot = await createRuntimeRoot();
  const app = await launchLocalTeam({ scenario: 'pending_approval', runtimeRoot });

  try {
    await selectObsidianTheme(app.mainPage);
    await openWorkspace(app.mainPage);
    await goToTeam(app.mainPage);
    await goToAgent(app.mainPage);

    await app.mainPage.getByTestId('agent-approval-deny-approval-implementer-status').click();

    await expect(app.mainPage.getByText('No pending approvals for this member.')).toBeVisible();
    await expect(app.mainPage.getByText('denied')).toBeVisible();
    await expect(app.mainPage.getByText('git status --short')).toBeVisible();
  } finally {
    await app.close();
    await cleanupRuntimeRoot(runtimeRoot);
  }
});
