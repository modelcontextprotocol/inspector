import { test, expect } from "@playwright/test";

const AUTH_TOKEN = process.env.MCP_PROXY_AUTH_TOKEN ?? "";
const APP_URL = AUTH_TOKEN
  ? `http://localhost:6274/?MCP_PROXY_AUTH_TOKEN=${AUTH_TOKEN}`
  : "http://localhost:6274/";

test.describe("Resource Refresh Button", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(APP_URL);

    // Set up STDIO transport with server-everything
    const transportSelect = page.getByLabel("Transport Type");
    await expect(transportSelect).toBeVisible();
    await expect(transportSelect).toContainText("STDIO");

    const commandInput = page.locator("#command-input");
    await commandInput.fill("npx");

    const argsInput = page.locator("#arguments-input");
    await argsInput.fill("-y @modelcontextprotocol/server-everything@latest");

    // Connect
    await page.getByRole("button", { name: "Connect" }).click();

    // Wait for connection to be established
    await expect(page.getByRole("button", { name: "Disconnect" })).toBeVisible({
      timeout: 30000,
    });
  });

  test("should re-fetch resource when refresh button is clicked", async ({
    page,
  }) => {
    // Navigate to Resources tab
    await page.getByRole("tab", { name: "Resources" }).click();

    // List resources
    await page.getByRole("button", { name: "List Resources" }).click();

    // Wait for a resource to appear and click it
    const firstResource = page.getByText("architecture.md").first();
    await expect(firstResource).toBeVisible({ timeout: 10000 });
    await firstResource.click();

    // Wait for resource content to load
    await page.waitForTimeout(2000);

    // Count current resources/read entries in history
    const historyEntries = page.locator("text=resources/read");
    const initialCount = await historyEntries.count();
    expect(initialCount).toBeGreaterThanOrEqual(1);

    // Click the Refresh button
    await page.getByRole("button", { name: "Refresh" }).click();

    // Verify a new resources/read request appeared in history
    await expect(historyEntries).toHaveCount(initialCount + 1, {
      timeout: 10000,
    });
  });
});
