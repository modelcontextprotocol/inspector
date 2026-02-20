import { test, expect } from "@playwright/test";

const APP_URL = "http://localhost:6274/";

test.describe("JsonView Copy Button", () => {
  test("copy button should not overlap with long text content", async ({
    page,
  }) => {
    // Navigate to tools tab which uses JsonView
    await page.goto(`${APP_URL}#tools`);

    // Wait for the tools tab to be visible
    await page.waitForSelector('[role="tabpanel"][data-state="active"]');

    // Select a tool and run it to generate output
    await page.click("text=List Tools");
    await page.waitForSelector(".font-mono"); // Wait for JsonView to render

    // Get the content area and copy button positions
    const contentBox = await page.locator(".font-mono").boundingBox();
    const copyButton = await page
      .locator("button:has(svg)")
      .first()
      .boundingBox();

    if (contentBox && copyButton) {
      // Verify button doesn't overlap with content area
      expect(contentBox.x + contentBox.width).toBeLessThan(copyButton.x);
    }
  });
});
