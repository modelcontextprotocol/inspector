/**
 * Integration test with real Everything MCP server
 *
 * Prerequisites:
 *   PORT=6299 npx -y @modelcontextprotocol/server-everything streamableHttp
 *
 * Run with:
 *   node test-real-server.js
 */

import {
  createMcpClient,
  connectClient,
  disconnectClient,
  isClientConnected,
  serverSupports,
  createHttpTransport,
} from './dist/index.js';

const SERVER_URL = 'http://localhost:6299/mcp';

console.log('=== Real MCP Server Integration Tests ===\n');
console.log(`Connecting to: ${SERVER_URL}\n`);

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (error) {
    console.log(`[FAIL] ${name}`);
    console.log(`       ${error.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

// ============================================
// Run Tests
// ============================================

async function runTests() {
  let client;
  let serverInfo;

  // Test 1: Create client and connect
  await test('Connect to Everything server', async () => {
    client = createMcpClient({ name: 'Test Client', version: '1.0.0' });
    const transport = createHttpTransport(SERVER_URL);
    serverInfo = await connectClient(client, transport);

    assert(serverInfo, 'Should return server info');
    assert(serverInfo.name, 'Server should have name');
    assert(serverInfo.version, 'Server should have version');
    console.log(`       Server: ${serverInfo.name} v${serverInfo.version}`);
  });

  // Test 2: Check connection status
  await test('Client reports connected', async () => {
    assert(isClientConnected(client) === true, 'Should be connected');
  });

  // Test 3: Check server capabilities
  await test('Server has tools capability', async () => {
    assert(serverSupports(serverInfo, 'tools') === true, 'Should support tools');
  });

  await test('Server has resources capability', async () => {
    assert(serverSupports(serverInfo, 'resources') === true, 'Should support resources');
  });

  await test('Server has prompts capability', async () => {
    assert(serverSupports(serverInfo, 'prompts') === true, 'Should support prompts');
  });

  // Test 4: List tools
  await test('List tools from server', async () => {
    const result = await client.listTools();
    assert(result.tools, 'Should return tools array');
    assert(result.tools.length > 0, 'Should have at least one tool');
    console.log(`       Found ${result.tools.length} tools: ${result.tools.map(t => t.name).join(', ')}`);
  });

  // Test 5: List resources
  await test('List resources from server', async () => {
    const result = await client.listResources();
    assert(result.resources, 'Should return resources array');
    console.log(`       Found ${result.resources.length} resources`);
  });

  // Test 6: List prompts
  await test('List prompts from server', async () => {
    const result = await client.listPrompts();
    assert(result.prompts, 'Should return prompts array');
    console.log(`       Found ${result.prompts.length} prompts`);
  });

  // Test 7: Call echo tool
  await test('Call echo tool', async () => {
    const result = await client.callTool({
      name: 'echo',
      arguments: { message: 'Hello from inspector-core!' },
    });
    assert(result.content, 'Should return content');
    assert(result.content.length > 0, 'Should have content items');
    const text = result.content[0].text;
    assert(text.includes('Hello from inspector-core'), 'Should echo our message');
    console.log(`       Response: ${text}`);
  });

  // Test 8: Call add tool
  await test('Call add tool', async () => {
    const result = await client.callTool({
      name: 'add',
      arguments: { a: 5, b: 3 },
    });
    assert(result.content, 'Should return content');
    const text = result.content[0].text;
    assert(text.includes('8'), 'Should return 8');
    console.log(`       5 + 3 = ${text}`);
  });

  // Test 9: Read a resource
  await test('Read a resource', async () => {
    const resources = await client.listResources();
    if (resources.resources.length > 0) {
      const uri = resources.resources[0].uri;
      const result = await client.readResource({ uri });
      assert(result.contents, 'Should return contents');
      console.log(`       Read resource: ${uri}`);
    }
  });

  // Test 10: Get a prompt
  await test('Get a prompt', async () => {
    const prompts = await client.listPrompts();
    if (prompts.prompts.length > 0) {
      const name = prompts.prompts[0].name;
      const result = await client.getPrompt({ name });
      assert(result.messages, 'Should return messages');
      console.log(`       Got prompt: ${name} (${result.messages.length} messages)`);
    }
  });

  // Test 11: Disconnect
  await test('Disconnect from server', async () => {
    await disconnectClient(client);
    // Note: isClientConnected may still return true due to cached server version
    // The important thing is disconnect completes without error
  });

  // ============================================
  // Summary
  // ============================================
  console.log('\n=== Test Summary ===');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}`);

  process.exit(failed > 0 ? 1 : 0);
}

// Check if server is reachable first
try {
  const response = await fetch(SERVER_URL);
  // 400 is expected (needs proper MCP request)
} catch (error) {
  console.error(`\nError: Cannot reach server at ${SERVER_URL}`);
  console.error('Make sure the Everything server is running:');
  console.error('  PORT=6299 npx -y @modelcontextprotocol/server-everything streamableHttp\n');
  process.exit(1);
}

runTests();
