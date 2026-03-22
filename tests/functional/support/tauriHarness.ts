import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';

const REPO_ROOT = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const DEFAULT_TIMEOUT_MS = 180_000;

export interface LaunchOptions {
  scenario: 'empty_state' | 'session_ready' | 'pending_approval' | 'bridge_recovery';
  runtimeRoot?: string;
  workspace?: string;
}

export interface LocalTeamApp {
  browser: Browser;
  context: BrowserContext;
  mainPage: Page;
  logs: () => string;
  runtimeRoot: string;
  workspace: string;
  waitForPageByTestId: (testId: string, timeoutMs?: number) => Promise<Page>;
  close: () => Promise<void>;
}

export async function createRuntimeRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'localteam-functional-'));
}

export async function cleanupRuntimeRoot(runtimeRoot: string): Promise<void> {
  await rm(runtimeRoot, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 500,
  }).catch(() => undefined);
}

export async function launchLocalTeam(options: LaunchOptions): Promise<LocalTeamApp> {
  if (process.platform !== 'win32') {
    throw new Error('The functional suite requires Windows WebView2.');
  }

  const runtimeRoot = options.runtimeRoot ?? (await createRuntimeRoot());
  const workspace = options.workspace ?? REPO_ROOT;
  const appDataDir = join(runtimeRoot, 'appdata');
  const webview2DataDir = join(runtimeRoot, 'webview2');
  const cdpPort = await getFreePort();

  await mkdir(appDataDir, { recursive: true });
  await mkdir(webview2DataDir, { recursive: true });

  const logs: string[] = [];
  const child = spawn(...buildLaunchCommand(options.scenario, workspace, appDataDir, webview2DataDir, cdpPort));

  child.stdout.on('data', (chunk: Buffer) => {
    logs.push(chunk.toString());
  });
  child.stderr.on('data', (chunk: Buffer) => {
    logs.push(chunk.toString());
  });

  let browser: Browser | null = null;
  try {
    browser = await connectToCdp(child, logs, cdpPort);
    const context = await waitForContext(browser);
    const mainPage = await waitForMainPage(context);

    return {
      browser,
      context,
      mainPage,
      runtimeRoot,
      workspace,
      logs: () => logs.join(''),
      waitForPageByTestId: async (testId: string, timeoutMs = 30_000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          for (const page of context.pages()) {
            try {
              const locator = page.getByTestId(testId);
              if (await locator.isVisible({ timeout: 250 })) {
                return page;
              }
            } catch {
              // Keep polling while the page initializes.
            }
          }
          await delay(250);
        }

        throw new Error(`Timed out waiting for page with data-testid="${testId}".\n${logs.join('')}`);
      },
      close: async () => {
        await requestAppShutdown(mainPage).catch(() => undefined);
        await waitForProcessExit(child, 10_000).catch(() => undefined);
        await browser?.close().catch(() => undefined);
        await terminateProcessTree(child);
        await delay(500);
      },
    };
  } catch (error) {
    await browser?.close().catch(() => undefined);
    await terminateProcessTree(child);
    throw error;
  }
}

function buildLaunchCommand(
  scenario: LaunchOptions['scenario'],
  workspace: string,
  appDataDir: string,
  webview2DataDir: string,
  cdpPort: number,
): Parameters<typeof spawn> {
  const env = {
    ...process.env,
    LOCALTEAM_E2E_MODE: '1',
    LOCALTEAM_E2E_SCENARIO: scenario,
    LOCALTEAM_E2E_WORKSPACE: workspace,
    LOCALTEAM_APP_DATA_DIR: appDataDir,
    WEBVIEW2_USER_DATA_FOLDER: webview2DataDir,
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort}`,
  };

  if (process.platform === 'win32') {
    const command = process.env.ComSpec || 'cmd.exe';
    const args = [
      '/d',
      '/s',
      '/c',
      'npm run tauri -- dev --config src-tauri/tauri.e2e.conf.json --no-watch',
    ];

    return [
      command,
      args,
      {
        cwd: REPO_ROOT,
        env,
        stdio: 'pipe',
        windowsHide: true,
      },
    ];
  }

  return [
    'npm',
    ['run', 'tauri', '--', 'dev', '--config', 'src-tauri/tauri.e2e.conf.json', '--no-watch'],
    {
      cwd: REPO_ROOT,
      env,
      stdio: 'pipe',
    },
  ];
}

async function connectToCdp(
  child: ChildProcessWithoutNullStreams,
  logs: string[],
  port: number,
): Promise<Browser> {
  const endpoint = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + DEFAULT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`LocalTeam exited before CDP was available.\n${logs.join('')}`);
    }

    try {
      return await chromium.connectOverCDP(endpoint);
    } catch {
      await delay(1_000);
    }
  }

  throw new Error(`Timed out waiting for WebView2 CDP on ${endpoint}.\n${logs.join('')}`);
}

async function waitForContext(browser: Browser): Promise<BrowserContext> {
  const deadline = Date.now() + DEFAULT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const [context] = browser.contexts();
    if (context) {
      return context;
    }
    await delay(250);
  }

  throw new Error('Timed out waiting for a browser context.');
}

async function waitForMainPage(context: BrowserContext): Promise<Page> {
  const deadline = Date.now() + DEFAULT_TIMEOUT_MS;

  while (Date.now() < deadline) {
    for (const page of context.pages()) {
      try {
        await page.waitForLoadState('domcontentloaded', { timeout: 1_000 });
      } catch {
        // Ignore while the page is still booting.
      }

      const url = page.url();
      if (url.includes('localhost:1420') || url.includes('index.html')) {
        return page;
      }

      try {
        if (await page.getByTestId('theme-selector').isVisible({ timeout: 250 })) {
          return page;
        }
      } catch {
        // Keep polling until the app renders.
      }

      try {
        if (await page.getByTestId('app-root').isVisible({ timeout: 250 })) {
          return page;
        }
      } catch {
        // Keep polling until the app renders.
      }
    }

    await delay(250);
  }

  throw new Error('Timed out waiting for the main LocalTeam page.');
}

async function getFreePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to allocate a free TCP port.'));
        return;
      }

      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on('error', reject);
  });
}

async function waitForProcessExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<void> {
  await Promise.race([
    new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
    }),
    delay(timeoutMs).then(() => {
      throw new Error('Timed out waiting for the LocalTeam process to exit.');
    }),
  ]);
}

async function terminateProcessTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }

  if (process.platform === 'win32' && child.pid) {
    await taskkill(child.pid, false);
    await waitForProcessExit(child, 10_000).catch(async () => {
      await taskkill(child.pid!, true);
      await waitForProcessExit(child, 10_000).catch(() => undefined);
    });
    return;
  }

  if (!child.killed) {
    child.kill('SIGTERM');
  }

  await waitForProcessExit(child, 10_000).catch(() => {
    if (!child.killed) {
      child.kill('SIGKILL');
    }
  });
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestAppShutdown(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const bridge = (
      window as Window & {
        __LOCALTEAM_E2E__?: {
          shutdownApp?: () => Promise<void>;
        };
      }
    ).__LOCALTEAM_E2E__;

    await bridge?.shutdownApp?.();
  });
}

async function taskkill(pid: number, force: boolean): Promise<void> {
  await new Promise<void>((resolve) => {
    const command = force ? `taskkill /pid ${pid} /t /f` : `taskkill /pid ${pid} /t`;
    const killer = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.once('exit', () => resolve());
    killer.once('error', () => resolve());
  });
}
