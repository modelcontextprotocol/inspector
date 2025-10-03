import { defineConfig, devices } from "@playwright/test";

const getWebServerCommand = () => {
  /**
   * The content of the fixture configuration file matches the inline arguments such
   * that the same set of tests (tagged `@cli`) can run in both scenarios.
   */
  switch (process.env.CLI_TEST_SCENARIO) {
    case "file":
      return "npx . --config client/e2e/fixtures/everything-server.json --server everything";
    case "inline":
      return "npx . -e FOO=bar -e BAZ=bat npm --silent --prefix /path/to/mcp/servers/src/everything run start";
    default:
      return "npm run dev";
  }
};

/**
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  /* Run your local dev server before starting the tests */
  webServer: {
    cwd: "..",
    command: getWebServerCommand(),
    url: "http://localhost:6274/?MCP_PROXY_AUTH_TOKEN=abc123",
    reuseExistingServer: !process.env.CI,
    env: {
      MCP_AUTO_OPEN_ENABLED: "false",
      MCP_PROXY_AUTH_TOKEN: "abc123",
    },
  },

  testDir: "./e2e",
  outputDir: "./e2e/test-results",
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: process.env.CI ? 1 : undefined,

  /* Reporter to use. See https://playwright.dev/docs/test-reporters
   *   Use `--reporter [type]` to override for more information while debugging tests.
   *   e.g., `npx playwright test --reporter list [args]`
   */
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
    baseURL: "http://localhost:6274/?MCP_PROXY_AUTH_TOKEN=abc123",

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: "on-first-retry",

    /* Take screenshots on failure */
    screenshot: "only-on-failure",

    /* Record video on failure */
    video: "retain-on-failure",

    /* Useful for local debugging */
    // headless: false,
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
