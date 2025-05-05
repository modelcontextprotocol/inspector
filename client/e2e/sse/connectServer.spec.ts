import { test, expect } from '@playwright/test';

test.describe('Connect MCP Server Using SSE In Inspector UI', () => {

  test('should connect to test server using SSE and verify echo tool', async ({ page }) => {
    // Load the inspector UI
    await page.goto('/');

    // Set server URL and transport type in localStorage
    await page.evaluate(() => {
      localStorage.setItem('lastSseUrl', 'http://localhost:3001/sse');
      localStorage.setItem('lastTransportType', 'sse');
    });
    await page.reload();

    // Wait for and click connect button
    const connectButton = await page.waitForSelector('[data-testid="connect-button"]', { state: 'visible' });
    await connectButton.click();

    // Wait for connection status to show connected and verify
    const connectedText = page.getByText('Connected');
    await expect(connectedText).toBeVisible({ timeout: 10000 });

    // Find and expand the initialize entry in History
    const initializeEntry = page.getByText('1. initialize');
    await expect(initializeEntry).toBeVisible();
    await initializeEntry.click();

    // Verify server info content in initialize response from History pane
    const jsonView = page.getByTestId('history-entry-0-response')
      .locator('.font-mono');
    await expect(jsonView).toBeVisible();
    await expect(jsonView).toContainText('capabilities');
    await expect(jsonView).toContainText('serverInfo');
    await expect(jsonView).toContainText('example-servers/everything');
    await expect(jsonView).toContainText('version');

    // Navigate to Tools tab and wait for it to be active
    const toolsTab = page.getByRole('tab', { name: 'Tools' });
    await toolsTab.click();
    await expect(toolsTab).toHaveAttribute('aria-selected', 'true');

    // Click the List Tools button to load available tools
    const listToolsButton = page.getByRole('button', { name: 'List Tools' });
    await expect(listToolsButton).toBeVisible();
    await listToolsButton.click();

    // Wait for tools list to be loaded and verify echo tool exists
    const echoTool = page.getByText('echo', { exact: true });
    await expect(echoTool).toBeVisible({ timeout: 5000 });
    await echoTool.click();

    // Wait for message input to be available
    const messageInput = page.getByLabel('message');
    await expect(messageInput).toBeVisible();
    await messageInput.fill('Hello MCP!');

    // Call the tool and wait for response
    const callButton = page.getByRole('button', { name: 'Run Tool' });
    await expect(callButton).toBeEnabled();
    await callButton.click();

    // Verify the response with increased timeout
    await expect(page.getByText('Echo: Hello MCP!')).toBeVisible({ timeout: 10000 });
  });

  test('completes OAuth authentication flow', async ({ page }) => {
    /* TODO: Add auth wrapper and reference for tests, then complete the following:
      * This test will verify the e2e OAuth authentication flow:
      * - Verify 401 Unauthorized triggers OAuth flow
      * - Check OAuth metadata endpoint access (no CORS errors)
      * - Verify redirect sequence
      * 
      * Post-Auth Verification:
      * - Verify successful connection after auth
      * - Check server capabilities and tools access
      */

    // Load the inspector UI
    await page.goto('/');

    // Set server URL and transport type in localStorage
    await page.evaluate(() => {
      localStorage.setItem('lastSseUrl', 'http://localhost:3001/sse');
      localStorage.setItem('lastTransportType', 'sse');
    });
    await page.reload();

    // Collect all console messages
    const consoleMessages: string[] = [];
    page.on('console', msg => {
      consoleMessages.push(msg.text());
    });

    // Wait for and click connect button
    const connectButton = await page.waitForSelector('[data-testid="connect-button"]', { state: 'visible' });
    await connectButton.click();

    // Original assertions from previous implementation attempt for reference:
    // Wait for login page redirect to consent UI
    // await page.waitForURL(/localhost:3001\/consent/, { timeout: 35000 }); // Increased to account for 30s delay

    // Verify console messages appeared in correct order
    expect(consoleMessages).toContainEqual(expect.stringContaining('401 (Unauthorized)'));
    // expect(consoleMessages).toContainEqual(expect.stringContaining('Failed to connect to MCP Server via the MCP Inspector Proxy'));
    // expect(consoleMessages).toContainEqual(expect.stringContaining('[Auth Flow] Got 401, starting OAuth flow'));
    // expect(consoleMessages).toContainEqual(expect.stringContaining('[Auth Flow] Saved server URL:'));
    
    // Verify OAuth metadata endpoint was accessed successfully (no CORS error)
    expect(consoleMessages).not.toContainEqual(expect.stringContaining('blocked by CORS policy'));
    
    // Verify redirect sequence
    // expect(consoleMessages).toContainEqual(expect.stringContaining('[Auth Flow] Redirecting to:'));
  });
});
