import { expect, test } from '@playwright/test';

import {
  emitWorkspaceSelected,
  goToAgent,
  goToTeam,
  openWorkspace,
  selectObsidianTheme,
  triggerSidecarTermination,
} from './support/helpers';
import {
  cleanupRuntimeRoot,
  createRuntimeRoot,
  launchLocalTeam,
} from './support/tauriHarness';

test.skip(process.platform !== 'win32', 'Functional suite requires Windows WebView2.');

test('surfaces bridge termination in detail and dashboard views and recovers through restart', async () => {
  const runtimeRoot = await createRuntimeRoot();
  const app = await launchLocalTeam({ scenario: 'bridge_recovery', runtimeRoot });

  try {
    await selectObsidianTheme(app.mainPage);
    await openWorkspace(app.mainPage);
    await goToTeam(app.mainPage);
    await goToAgent(app.mainPage);

    await triggerSidecarTermination(app.mainPage, 'E2E bridge terminated.');

    await expect(app.mainPage.getByTestId('agent-sidecar-error')).toContainText(
      'E2E bridge terminated.',
    );

    await app.mainPage.getByTestId('breadcrumb-project-1').click();
    await expect(app.mainPage.getByText('E2E bridge terminated.')).toBeVisible();

    await app.mainPage.getByTestId('sidebar-agent-implementer').click();
    await expect(app.mainPage.getByTestId('agent-restart-bridge')).toBeVisible();

    await app.mainPage.getByTestId('agent-restart-bridge').click();
    await expect(app.mainPage.getByTestId('agent-sidecar-error')).toHaveCount(0);
    await expect(app.mainPage.getByText('Bridge is healthy and streaming activity.')).toBeVisible();
  } finally {
    await app.close();
    await cleanupRuntimeRoot(runtimeRoot);
  }
});

test('loads a workspace from the native workspace-selected event path', async () => {
  const runtimeRoot = await createRuntimeRoot();
  const app = await launchLocalTeam({ scenario: 'empty_state', runtimeRoot });

  try {
    await selectObsidianTheme(app.mainPage);
    await emitWorkspaceSelected(app.mainPage);

    await expect(app.mainPage.getByTestId('project-view')).toBeVisible();
    await expect(app.mainPage.getByText(`Project path: ${app.workspace}`)).toBeVisible();
  } finally {
    await app.close();
    await cleanupRuntimeRoot(runtimeRoot);
  }
});
