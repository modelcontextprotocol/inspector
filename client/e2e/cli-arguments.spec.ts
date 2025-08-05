import { test, expect } from "@playwright/test";

// Adjust the URL if your dev server runs on a different port
const APP_URL = "http://localhost:6274/?MCP_PROXY_AUTH_TOKEN=abc123";

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
