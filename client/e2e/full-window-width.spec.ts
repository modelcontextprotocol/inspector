import { test, expect } from "@playwright/test";

// Regression for #876 — body{ place-items: center } in the Vite template
// default centered the React tree inside a grid context and left visible
// margins on either side. The app root should fill the viewport width.
const APP_URL = "http://localhost:6274/";
const VIEWPORT = { width: 1920, height: 1080 };
// Allow for a scrollbar gutter; widths within this tolerance count as "filled".
const TOLERANCE_PX = 20;

test.describe("Full window width", () => {
  test.use({ viewport: VIEWPORT });

  test("app root fills the viewport width", async ({ page }) => {
    await page.goto(APP_URL);

    const rootWidth = await page.evaluate(() => {
      const root = document.getElementById("root");
      if (!root) throw new Error("#root not found");
      return root.getBoundingClientRect().width;
    });

    expect(rootWidth).toBeGreaterThanOrEqual(VIEWPORT.width - TOLERANCE_PX);
  });

  test("body does not center its children via grid", async ({ page }) => {
    await page.goto(APP_URL);

    const placeItems = await page.evaluate(
      () => getComputedStyle(document.body).placeItems,
    );

    // `normal normal` (or just `normal`) is the default; `center` was the bug.
    expect(placeItems).not.toContain("center");
  });
});
