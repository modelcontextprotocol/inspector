import { defineConfig, devices } from "@playwright/test";

const inspectorUrl = "http://localhost:6274"

/**
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  /* Run your local dev server before starting the tests */
  webServer: {
    cwd: "..",
    command: "npm run dev",
    url: inspectorUrl,
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    env: {
      MCP_AUTO_OPEN_ENABLED: false,
    }
  },

  testDir: "./e2e",
  testIgnore: "**/everything-server.spec.ts",
  outputDir: "./e2e/test-results",
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: process.env.CI
    ? [
        ["html", { outputFolder: "playwright-report" }],
        ["json", { outputFile: "results.json" }],
        ["line"],
      ]
    : [["line"]],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: inspectorUrl,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: "on-first-retry",

    /* Take screenshots on failure */
    screenshot: "only-on-failure",

    /* Record video on failure */
    video: "retain-on-failure",
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },

    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },

    // Skip WebKit on macOS due to compatibility issues
    ...(process.platform !== "darwin"
      ? [
          {
            name: "webkit",
            use: { ...devices["Desktop Safari"] },
          },
        ]
      : []),
  ],
});
