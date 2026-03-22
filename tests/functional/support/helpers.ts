import { expect, type Page } from '@playwright/test';

export async function selectObsidianTheme(page: Page): Promise<void> {
  await expect(page.getByTestId('theme-selector')).toBeVisible();
  await page.getByTestId('theme-card-obsidian').click();
  await expect(page.getByTestId('global-view')).toBeVisible();
}

export async function openWorkspace(page: Page): Promise<void> {
  await page.getByTestId('global-open-workspace').click();
  await expect(page.getByTestId('project-view')).toBeVisible();
}

export async function goToTeam(page: Page): Promise<void> {
  await page.getByTestId('project-team-ops-alpha').click();
  await expect(page.getByTestId('team-view')).toBeVisible();
}

export async function goToAgent(page: Page): Promise<void> {
  await page.getByTestId('team-member-implementer').click();
  await expect(page.getByTestId('agent-view')).toBeVisible();
}

export async function emitWorkspaceSelected(page: Page, rootPath?: string): Promise<void> {
  await page.evaluate(async (value) => {
    const bridge = (
      window as Window & {
        __LOCALTEAM_E2E__?: {
          emitWorkspaceSelected: (rootPath?: string) => Promise<void>;
        };
      }
    ).__LOCALTEAM_E2E__;

    if (!bridge) {
      throw new Error('LocalTeam E2E bridge is not available.');
    }
    await bridge.emitWorkspaceSelected(value ?? undefined);
  }, rootPath);
}

export async function triggerSidecarTermination(page: Page, detail?: string): Promise<void> {
  await page.evaluate(async (value) => {
    const bridge = (
      window as Window & {
        __LOCALTEAM_E2E__?: {
          triggerSidecarTermination: (detail?: string) => Promise<void>;
        };
      }
    ).__LOCALTEAM_E2E__;

    if (!bridge) {
      throw new Error('LocalTeam E2E bridge is not available.');
    }
    await bridge.triggerSidecarTermination(value ?? undefined);
  }, detail);
}
