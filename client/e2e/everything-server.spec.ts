import { test, expect } from "@playwright/test";

test.describe("Everything Server Integration", () => {
  test.skip(!process.env.EVERYTHING_SERVER_PATH, 'EVERYTHING_SERVER_PATH environment variable is required');

  let page;

  test.beforeAll(async ({ browser, baseURL }) => {
    page = await browser.newPage();

    page.on('requestfailed', request => {
      const errorText = request.failure()?.errorText;
      const url = request.url();

      // Expected: MCP connection abort during disconnect
      if (errorText === 'net::ERR_ABORTED' && url.includes('/stdio')) {
        console.log(`Expected at Disconnect: ${request._guid} (${errorText})`);
        return;
      }

      // console.log(`REQ FAILED: ${request._guid}`);
      // console.log(`    REQ FAILED ${request._guid}: ${errorText}`);
      // console.log(`    REQ FAILED ${request._guid}: ${request.method()}`);
      // console.log(`    REQ FAILED ${request._guid}: ${url}`);
    });

    // page.on('request', async request => {
    //   console.log(`REQUEST: ${request._guid}`);
    //   console.log(`    REQ METHOD ${request._guid}: ${request.method()}`);
    //   console.log(`    REQ URL ${request._guid}: ${request.url()}`);
    //   console.log(`    REQ HEADERS ${request._guid}: ${JSON.stringify(await request.allHeaders(), null, 2)}`);
    //   console.log(`    REQ POST DATA ${request._guid}: ${request.postData()}`);
    // });

    // page.on('response', response => {
    //   console.log(`RESPONSE ${response.request()._guid}:`);
    //   console.log(`    RESP STATUS ${response.request()._guid}: ${response.status()}`);
    //   console.log(`    RESP URL ${response.request()._guid}: ${response.url()}`);
    //   console.log(`    BODY: ${await response.body()}`);
    // });


    await page.goto(baseURL);
    await expect(page.getByLabel("Transport Type")).toBeVisible();

    // Fill in the form to connect to the everything server
    const everythingServerPath = process.env.EVERYTHING_SERVER_PATH!;

    // Ensure Transport Type is set to STDIO
    const transportTypeCombo = page.getByLabel("Transport Type");
    await transportTypeCombo.click();
    // Select STDIO from the dropdown options (not the label)
    await page.locator('[role="option"]').getByText("STDIO").click();

    // Fill in the command field
    const commandInput = page.getByRole('textbox', { name: 'Command' });
    await commandInput.fill('npm');

    // Fill in the arguments field with the everything server startup command
    const argumentsInput = page.getByRole('textbox', { name: 'Arguments' });
    await argumentsInput.fill(`--prefix ${everythingServerPath} --loglevel silent run start`);

    const connectButton = page.locator('button:text-is("Connect")');
    await expect(connectButton).toBeVisible({ timeout: 10000 });
    await connectButton.click();

    await page.waitForTimeout(250);

    const connectedIndicator = page.locator('text="Connected"');
    const greenCircle = page.locator('.bg-green-500');
    await expect(connectedIndicator).toBeVisible({ timeout: 10000 });
    await expect(greenCircle).toBeVisible({ timeout: 10000 });
  });

  test.afterAll(async () => {
    if (page) {
      const disconnectButton = page.locator('button:text-is("Disconnect")');
      if (await disconnectButton.isVisible({ timeout: 500 })) {
        await disconnectButton.click();
        await page.waitForTimeout(250);
      }

      await page.close();
    }
  });

  test("should list tools from the everything server", async () => {
    const toolsTab = page.getByRole("tab", { name: "Tools" });
    await toolsTab.click();

    const toolsTabPanel = page.getByRole('tabpanel', { name: 'Tools' });
    const listToolsButton = toolsTabPanel.getByRole("button", { name: "List Tools" });
    await expect(listToolsButton).toBeVisible({ timeout: 500 });
    await listToolsButton.click();
    
    const knownTools = ['echo', 'add', 'longRunningOperation', 'printEnv', 'sampleLLM'];
    let foundToolsCount = 0;

    for (const toolName of knownTools) {
      const toolElement = toolsTabPanel.locator(`text="${toolName}"`).first();
      await expect(toolElement).toBeVisible({ timeout: 2000 });
      foundToolsCount++;
    }

    expect(foundToolsCount).toBeGreaterThanOrEqual(3);
  });

  test.describe("structuredContent tool", () => {
    test("should display tool details when selected", async () => {
      const toolsTab = page.getByRole("tab", { name: "Tools" });
      await toolsTab.click();

      const toolsTabPanel = page.getByRole('tabpanel', { name: 'Tools' });
      const structuredContentTool = toolsTabPanel.locator('text="structuredContent"').first();
      await expect(structuredContentTool).toBeVisible({ timeout: 2000 });
      await structuredContentTool.click();

      const toolHeader = page.getByRole('heading', { name: 'structuredContent' });
      await expect(toolHeader).toBeVisible();
    });

    test("should show error when executing structuredContent without required inputs", async () => {
      const toolsTab = page.getByRole("tab", { name: "Tools" });
      await toolsTab.click();

      const toolsTabPanel = page.getByRole('tabpanel', { name: 'Tools' });
      const structuredContentTool = toolsTabPanel.locator('text="structuredContent"').first();
      await expect(structuredContentTool).toBeVisible({ timeout: 2000 });
      await structuredContentTool.click();

      const runButton = page.getByRole("button", { name: "Run Tool" });
      await expect(runButton).toBeVisible({ timeout: 500 });
      await runButton.click();

      const errorResultHeader = page.locator('h4').filter({ hasText: 'Tool Result: Error' });
      await expect(errorResultHeader).toBeVisible({ timeout: 500 });

      // Scope error message to the tool result area by using the error header as context
      const errorMessage = errorResultHeader.locator('..').getByText(/MCP error -32603/);
      await expect(errorMessage).toBeVisible({ timeout: 500 });
    });

    test("should execute structuredContent tool with proper inputs and show structured and unstructured results", async () => {
      const toolsTab = page.getByRole("tab", { name: "Tools" });
      await toolsTab.click();

      const toolsTabPanel = page.getByRole('tabpanel', { name: 'Tools' });
      const structuredContentTool = toolsTabPanel.locator('text="structuredContent"').first();
      await expect(structuredContentTool).toBeVisible({ timeout: 2000 });
      await structuredContentTool.click();

      const locationInput = page.getByRole('textbox', { name: 'location' });
      await expect(locationInput).toBeVisible({ timeout: 500 });
      await locationInput.fill("San Francisco");

      const runButton = page.getByRole("button", { name: "Run Tool" });
      await expect(runButton).toBeVisible({ timeout: 500 });
      await runButton.click();

      const successResultHeader = page.locator('h4').filter({ hasText: 'Tool Result: Success' });
      await expect(successResultHeader).toBeVisible({ timeout: 500 });

      const structuredContentHeader = page.getByRole('heading', { name: 'Structured Content:', exact: true });
      await expect(structuredContentHeader).toBeVisible({ timeout: 500 });

      const unstructuredContentHeader = page.getByRole('heading', { name: 'Unstructured Content:', exact: true });
      await expect(unstructuredContentHeader).toBeVisible({ timeout: 500 });

      const schemaValidationMessage = page.locator('text="✓ Valid according to output schema"');
      await expect(schemaValidationMessage).toBeVisible({ timeout: 500 });

      const contentMatchingMessage = page.locator('text="✓ Unstructured content matches structured content"');
      await expect(contentMatchingMessage).toBeVisible({ timeout: 500 });
    });

    test("should show error when input is cleared after successful execution", async () => {
      const toolsTab = page.getByRole("tab", { name: "Tools" });
      await toolsTab.click();

      const toolsTabPanel = page.getByRole('tabpanel', { name: 'Tools' });
      const structuredContentTool = toolsTabPanel.locator('text="structuredContent"').first();
      await expect(structuredContentTool).toBeVisible({ timeout: 2000 });
      await structuredContentTool.click();

      const locationInput = page.getByRole('textbox', { name: 'location' });
      await expect(locationInput).toBeVisible({ timeout: 500 });
      await locationInput.fill("New York");

      const runButton = page.getByRole("button", { name: "Run Tool" });
      await expect(runButton).toBeVisible({ timeout: 500 });
      await runButton.click();

      const successResultHeader = page.locator('h4').filter({ hasText: 'Tool Result: Success' });
      await expect(successResultHeader).toBeVisible({ timeout: 500 });

      await locationInput.fill("");
      await runButton.click();

      const errorResultHeader = page.locator('h4').filter({ hasText: 'Tool Result: Error' });
      await expect(errorResultHeader).toBeVisible({ timeout: 500 });

      const errorMessage = errorResultHeader.locator('..').getByText(/MCP error -32603/);
      await expect(errorMessage).toBeVisible({ timeout: 500 });
    });
  });
});
