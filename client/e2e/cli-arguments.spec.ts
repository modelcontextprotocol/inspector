import { test, expect } from "@playwright/test";

// Adjust the URL if your dev server runs on a different port
const APP_URL = "http://localhost:6274/?MCP_PROXY_AUTH_TOKEN=abc123";

// These tests verify that CLI arguments correctly set URL parameters
// The CLI should parse config files and pass transport/serverUrl as URL params
test.describe("CLI Arguments", () => {
  test("should pass transport parameter from command line", async ({
    page,
  }) => {
    // Simulate: npx . --transport sse --server-url http://localhost:3000/sse
    await page.goto(
      `${APP_URL}&transport=sse&serverUrl=http://localhost:3000/sse`,
    );

    // Wait for the Transport Type dropdown to be visible
    const selectTrigger = page.getByLabel("Transport Type");
    await expect(selectTrigger).toBeVisible();

    // Verify transport dropdown shows SSE
    await expect(selectTrigger).toContainText("SSE");

    // Verify URL field is visible and populated
    const urlInput = page.locator("#sse-url-input");
    await expect(urlInput).toBeVisible();
    await expect(urlInput).toHaveValue("http://localhost:3000/sse");
  });

  test("should pass transport parameter for streamable-http", async ({
    page,
  }) => {
    // Simulate config with streamable-http transport
    await page.goto(
      `${APP_URL}&transport=streamable-http&serverUrl=http://localhost:3000/mcp`,
    );

    // Wait for the Transport Type dropdown to be visible
    const selectTrigger = page.getByLabel("Transport Type");
    await expect(selectTrigger).toBeVisible();

    // Verify transport dropdown shows Streamable HTTP
    await expect(selectTrigger).toContainText("Streamable HTTP");

    // Verify URL field is visible and populated
    const urlInput = page.locator("#sse-url-input");
    await expect(urlInput).toBeVisible();
    await expect(urlInput).toHaveValue("http://localhost:3000/mcp");
  });

  test("should not pass transport parameter for stdio config", async ({
    page,
  }) => {
    // Simulate stdio config (no transport param needed)
    await page.goto(APP_URL);

    // Wait for the Transport Type dropdown to be visible
    const selectTrigger = page.getByLabel("Transport Type");
    await expect(selectTrigger).toBeVisible();

    // Verify transport dropdown defaults to STDIO
    await expect(selectTrigger).toContainText("STDIO");

    // Verify command/args fields are visible
    await expect(page.locator("#command-input")).toBeVisible();
    await expect(page.locator("#arguments-input")).toBeVisible();
  });
});

test.describe("CLI npx (npm exec) start up", { tag: "@cli" }, () => {
  test("CLI arguments should populate form fields", async ({ page }) => {
    const cliTestScenario = process.env.CLI_TEST_SCENARIO;

    // Skip this test if not running a CLI test scenario
    if (
      !cliTestScenario ||
      (cliTestScenario !== "inline" && cliTestScenario !== "file")
    ) {
      test.skip();
      return;
    }

    await page.goto(APP_URL);

    const commandInput = page.getByRole("textbox", { name: "Command" });
    const argsInput = page.getByRole("textbox", { name: "Arguments" });

    await expect(commandInput).toHaveValue("npm");
    await expect(argsInput).toHaveValue(
      "--silent --prefix /path/to/mcp/servers/src/everything run start",
    );
  });
});
