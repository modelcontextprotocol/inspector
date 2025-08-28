import { test, expect } from "@playwright/test";

// Adjust the URL if your dev server runs on a different port
const APP_URL = "http://localhost:6274/?MCP_PROXY_AUTH_TOKEN=abc123";

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

  test("should show Command and Arguments fields and hide URL field when Transport Type is STDIO", async ({
    page,
  }) => {
    await page.goto(APP_URL);

    // Wait for the Transport Type dropdown to be visible
    const selectTrigger = page.getByLabel("Transport Type");
    await expect(selectTrigger).toBeVisible();

    // Open the dropdown and select STDIO
    await selectTrigger.click();
    await page.getByRole("option", { name: "STDIO" }).click();

    // Wait for the form to update
    await page.waitForTimeout(100);

    // Check that Command and Arguments fields are visible
    await expect(page.locator("#command-input")).toBeVisible();
    await expect(page.locator("#arguments-input")).toBeVisible();

    // Check that URL field is not visible
    await expect(page.locator("#sse-url-input")).not.toBeVisible();

    // Also verify the labels are present
    await expect(page.getByText("Command")).toBeVisible();
    await expect(page.getByText("Arguments")).toBeVisible();
    await expect(page.getByText("URL")).not.toBeVisible();
  });

  test("should show URL field and hide Command and Arguments fields when Transport Type is SSE", async ({
    page,
  }) => {
    await page.goto(APP_URL);

    // Wait for the Transport Type dropdown to be visible
    const selectTrigger = page.getByLabel("Transport Type");
    await expect(selectTrigger).toBeVisible();

    // Open the dropdown and select SSE
    await selectTrigger.click();
    await page.getByRole("option", { name: "SSE" }).click();

    // Wait for the form to update
    await page.waitForTimeout(100);

    // Check that URL field is visible
    await expect(page.locator("#sse-url-input")).toBeVisible();

    // Check that Command and Arguments fields are not visible
    await expect(page.locator("#command-input")).not.toBeVisible();
    await expect(page.locator("#arguments-input")).not.toBeVisible();

    // Also verify the labels are present/absent
    await expect(page.getByText("URL")).toBeVisible();
    await expect(page.getByText("Command")).not.toBeVisible();
    await expect(page.getByText("Arguments")).not.toBeVisible();
  });

  test("should show URL field and hide Command and Arguments fields when Transport Type is Streamable HTTP", async ({
    page,
  }) => {
    await page.goto(APP_URL);

    // Wait for the Transport Type dropdown to be visible
    const selectTrigger = page.getByLabel("Transport Type");
    await expect(selectTrigger).toBeVisible();

    // Open the dropdown and select Streamable HTTP
    await selectTrigger.click();
    await page.getByRole("option", { name: "Streamable HTTP" }).click();

    // Wait for the form to update
    await page.waitForTimeout(100);

    // Check that URL field is visible
    await expect(page.locator("#sse-url-input")).toBeVisible();

    // Check that Command and Arguments fields are not visible
    await expect(page.locator("#command-input")).not.toBeVisible();
    await expect(page.locator("#arguments-input")).not.toBeVisible();

    // Also verify the labels are present/absent
    await expect(page.getByText("URL")).toBeVisible();
    await expect(page.getByText("Command")).not.toBeVisible();
    await expect(page.getByText("Arguments")).not.toBeVisible();
  });
});
