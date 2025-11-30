import { test, expect } from '@playwright/test';

/**
 * Smoke tests - Quick validation that the app is running
 * Run these at session start to catch regressions
 */

test.describe('Smoke Tests', () => {
  test('app loads successfully', async ({ page }) => {
    await page.goto('/');

    // Verify the page loaded (update selector once UI exists)
    await expect(page).toHaveTitle(/Inspector/i);
  });

  test('no console errors on load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    expect(errors).toHaveLength(0);
  });

  test('no uncaught exceptions', async ({ page }) => {
    const exceptions: Error[] = [];
    page.on('pageerror', (error) => {
      exceptions.push(error);
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    expect(exceptions).toHaveLength(0);
  });
});
