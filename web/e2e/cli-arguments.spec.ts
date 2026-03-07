import { test, expect } from "@playwright/test";

// These tests verify that CLI arguments correctly set URL parameters
// The CLI should parse config files and pass transport/serverUrl as URL params
test.describe("CLI Arguments @cli", () => {
  test("should pass transport parameter from command line", async ({
    page,
  }) => {
    // Simulate: npx . --transport sse --server-url http://localhost:3000/sse
    await page.goto(
      "http://localhost:6274/?transport=sse&serverUrl=http://localhost:3000/sse",
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
      "http://localhost:6274/?transport=streamable-http&serverUrl=http://localhost:3000/mcp",
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
    await page.goto("http://localhost:6274/");

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
