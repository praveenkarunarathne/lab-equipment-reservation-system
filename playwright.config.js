import { defineConfig, devices } from '@playwright/test';
import { BASE_URL } from './e2e/config.js';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: 'chromium' },
    },
  ],
  webServer: {
    command: 'bun --no-env-file run test:e2e:server',
    url: `${BASE_URL}/api/v1/health`,
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 180_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    env: { MONGOMS_VERSION: process.env.MONGOMS_VERSION ?? '8.0.32' },
  },
});
