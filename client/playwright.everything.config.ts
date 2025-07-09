import { defineConfig, devices } from "@playwright/test";

/**
 * Avoid the default ports (6274 and 6277), to allow the Inspector to be running
 * while Playwright tests run.
*/
const CLIENT_PORT = 7274;
const SERVER_PORT = 7277;

// FIXME:
//   MCP_PROXY_PORT is required due to the client not being implicitly aware of `SERVER_PORT`; bug.
//   Otherwise, need to process the *output* of `npm run dev`.
//   Same with the AUTH token, hence disabling below.
//
const INSPECTOR_URL = `http://localhost:${CLIENT_PORT}/?MCP_PROXY_PORT=${SERVER_PORT}`;

/**
 * Playwright configuration for testing with the "everything" MCP server
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  /* Run the Inspector with the "everything" server before starting tests */
  webServer: {
    cwd: "..",
    // FIXME:
    //   - exit much earlier unless EVERYTHING_SERVER_PATH is defined; and, rename this var
    //   - npm run prod ?
    //   - noisy output in CI output, silence startup and request logging?
    //   - this works because `npm ci` (in GitHub Action) auto-invokes `npm prepare`, which is configured to `npm run build`.
    //     - `npm ci` lifecycle -- https://docs.npmjs.com/cli/v11/using-npm/scripts#life-cycle-operation-order
    command: "npm run dev",
    env: {
      // FIXME: How to get the auth token from command stdout to Playwright to use as a URL param?
      DANGEROUSLY_OMIT_AUTH: true,

      CLIENT_PORT: CLIENT_PORT,
      SERVER_PORT: SERVER_PORT,

      // Disable auto-open.  Otherwise, when local, running the tests will open the Inspector in your current browser.
      // FIXME: This env wasn't inherited from the `npm run` script in `package.json`; why?
      MCP_AUTO_OPEN_ENABLED: "false",

      // FIXME: Has no effect?  Prob overrides the generated one, but still requires round-trip via query param.
      // MCP_PROXY_FULL_ADDRESS: `http://localhost:${SERVER_PORT}`,
    },

    url: INSPECTOR_URL,

    // This would allow Playwright to use an existing running server.
    //
    // For example, an already running dev server in a local dev environment.
    //
    // These tests are for a specific MCP Server, which may not be the one running in the local
    // server, so probably this isn't going to be useful.  Currently starting on different ports
    // anyway.
    //
    // If doing so, first investigate:
    //   - would doing so disrupt any in-progress work in that dev server? e.g., modified state (CSS, DOM, etc.)
    //   - would this affect the localStorage?
    //   - perhaps Playwright could use an anonymous/private tab?
    //   - headful and reuseExistingServer might cause Playwright to re-use localStorage,
    //     and the inspector stores settings in localstorage, so fiddling with auth and settings
    //     might be a problem *between* test runs

    reuseExistingServer: false, // !process.env.CI,

    timeout: 30 * 1000, // 30 seconds timeout for server startup

    // Wait for specific text that indicates the server is ready
    // You may need to adjust this based on the actual startup output
    stdout: "pipe",    // default is ignore
    // stderr: "pipe", // default is pipe
  },

  testDir: "./e2e",
  outputDir: "./e2e/results-everything",
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,

  /* FIXME: Revisit when there are more tests, offering parallel gains; adds complexity. */
  /* Opt out of parallel tests. */
  workers: 1,
  /* Run tests in files in parallel */
  /* fullyParallel: true, */

  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: process.env.CI
    ? [
        ["line"],
        ["html",  { outputFolder: "report-everything" }],
        ["json",  { outputFile: "report-everything.json" }],
      ]
    : [
        ["line"],
        ["html", { outputFolder: "report-everything", open: "never" }], // Generate trace viewer locally
      ],

  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: INSPECTOR_URL,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: "on-first-retry",

    /* Take screenshots on failure */
    screenshot: "only-on-failure",

    /* Record video on failure */
    video: "retain-on-failure",

    /* Action timeout */
    actionTimeout: 10000,
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        headless: true,
      },
    },
  ],
});
