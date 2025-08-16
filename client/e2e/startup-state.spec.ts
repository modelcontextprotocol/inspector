import { test, expect } from "@playwright/test";

// Adjust the URL if your dev server runs on a different port
const APP_URL = "http://localhost:6274/?MCP_PROXY_AUTH_TOKEN=abc123";

test.describe("Startup State", () => {
  test("should not navigate to a tab when Inspector first opens", async ({
    page,
  }) => {
    await page.goto(APP_URL);

    // Check that there is no hash fragment in the URL
    const url = page.url();
    expect(url).not.toContain("#");
  });
});
