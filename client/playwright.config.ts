import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60 * 1000,
  expect: {
    timeout: 5000
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.APP_URL || 'http://localhost:6274',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'sse',
      testDir: './e2e/sse',
      testMatch: '**/*.spec.ts',
      use: { 
        ...devices['Desktop Chrome'],
      },
    },
    {
      name: 'stdio',
      testDir: './e2e/stdio',
      testMatch: '**/*.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:6274',
    reuseExistingServer: !process.env.CI,
  },
});
