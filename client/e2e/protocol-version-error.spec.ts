import { test, expect } from "@playwright/test";
import { startUnsupportedProtocolServer } from "./fixtures/unsupported-protocol-server.js";

const APP_URL = "http://localhost:6274/";

test.describe("Protocol version negotiation errors", () => {
  test("surfaces -32602 initialize error and hides proxy token hint", async ({
    page,
  }) => {
    const fixture = await startUnsupportedProtocolServer();
    try {
      await page.goto(APP_URL);

      const transportSelect = page.getByLabel("Transport Type");
      await expect(transportSelect).toBeVisible();
      await transportSelect.click();
      await page.getByRole("option", { name: "Streamable HTTP" }).click();

      const connectionTypeSelect = page.getByLabel("Connection Type");
      await expect(connectionTypeSelect).toBeVisible();
      await connectionTypeSelect.click();
      await page.getByRole("option", { name: "Direct" }).click();

      await page.locator("#sse-url-input").fill(fixture.baseUrl);

      await page.getByRole("button", { name: "Connect" }).click();

      await expect(page.getByText(/MCP error\s*-32602/i).first()).toBeVisible({
        timeout: 10000,
      });

      await expect(
        page.getByText(/Did you add the proxy session token in Configuration/i),
      ).toHaveCount(0);

      await expect(
        page.locator('[data-testid="connection-error-details"]'),
      ).toBeVisible();
    } finally {
      await fixture.close();
    }
  });
});
