import { test, expect } from '@playwright/test';

/**
 * Server List E2E Tests
 * Tests for the initial server list screen (MCPJam-inspired)
 *
 * Related: upstream#947 - Add proposed spec for UX
 */

test.describe('Server List', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('displays empty state when no servers configured', async ({ page }) => {
    // TODO: Update selectors once UI is implemented
    await expect(page.getByTestId('server-list')).toBeVisible();
    await expect(page.getByTestId('empty-state')).toBeVisible();
  });

  test('shows add server button', async ({ page }) => {
    await expect(page.getByTestId('add-server-button')).toBeVisible();
  });

  test('can open add server dialog', async ({ page }) => {
    await page.getByTestId('add-server-button').click();
    await expect(page.getByTestId('add-server-dialog')).toBeVisible();
  });

  test('can add a server from JSON config', async ({ page }) => {
    // Related: upstream#904 - Option to paste MCP JSON
    await page.getByTestId('add-server-button').click();

    const configJson = JSON.stringify({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory']
    });

    await page.getByTestId('json-config-input').fill(configJson);
    await page.getByTestId('save-server-button').click();

    await expect(page.getByTestId('server-item')).toBeVisible();
  });
});
