import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/functional',
  fullyParallel: false,
  workers: 1,
  timeout: 240_000,
  expect: {
    timeout: 20_000,
  },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'output/playwright/report' }],
  ],
  outputDir: 'output/playwright/test-results',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
