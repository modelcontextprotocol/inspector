import { test, expect } from "@playwright/test";

// Adjust the URL if your dev server runs on a different port
const APP_URL = "http://localhost:6274/";

test.describe("Transport Type Dropdown", () => {
  test("should have options for STDIO, SSE, and Streamable HTTP", async ({
    page,
  }) => {
    await page.goto(APP_URL);

    // Wait for the Transport Type dropdown to be visible
    const selectTrigger = page.getByLabel("Transport Type");
    await expect(selectTrigger).toBeVisible();

    // Open the dropdown
    await selectTrigger.click();

    // Check for the three options
    await expect(page.getByRole("option", { name: "STDIO" })).toBeVisible();
    await expect(page.getByRole("option", { name: "SSE" })).toBeVisible();
    await expect(
      page.getByRole("option", { name: "Streamable HTTP" }),
    ).toBeVisible();
  });
});
