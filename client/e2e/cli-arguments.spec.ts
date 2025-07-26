import { test, expect } from "@playwright/test";

// Adjust the URL if your dev server runs on a different port
const APP_URL = "http://localhost:6274/";

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

    await expect(commandInput).toHaveValue("uv");
    await expect(argsInput).toHaveValue("run main.py");

    // Click to expand environment variables section
    const envButton = page.getByRole("button", {
      name: /Environment Variables/i,
    });
    await envButton.click();

    // Check that environment variables are populated (sorted alphabetically)
    const keyInputs = page.locator('input[placeholder="Key"]');
    const valueInputs = page.locator('input[placeholder="Value"]');

    await expect(keyInputs.first()).toHaveValue("BAZ");
    await expect(valueInputs.first()).toHaveValue("bat");
  });
});
