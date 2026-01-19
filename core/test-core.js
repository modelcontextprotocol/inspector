/**
 * Manual test script for inspector-core package
 * Run with: node test-core.mjs
 */

import {
  // Memory repositories
  createMemoryServerConfigRepository,
  createMemoryHistoryRepository,
  createMemoryLogsRepository,
  createMemoryTestingProfileRepository,

  // Memory services
  createMemoryConnectionService,
  createMemoryExecutionService,

  // Utilities
  isValidHttpUrl,
  generateSamplingRequestId,
  generateElicitationRequestId,

  // Client (can create, but not connect without server)
  createMcpClient,

  // Types/helpers
  createServerConfig,
  createHistoryEntry,
  createLogEntry,
  LOG_LEVELS,
} from './dist/index.js';

console.log('=== Inspector Core Package Tests ===\n');

// Track test results
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
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
// 1. URL Validation
// ============================================
console.log('\n--- URL Validation ---');

test('isValidHttpUrl accepts http://localhost:3000/mcp', () => {
  assert(isValidHttpUrl('http://localhost:3000/mcp') === true);
});

test('isValidHttpUrl accepts https://api.example.com/mcp', () => {
  assert(isValidHttpUrl('https://api.example.com/mcp') === true);
});

test('isValidHttpUrl rejects ftp://example.com', () => {
  assert(isValidHttpUrl('ftp://example.com') === false);
});

test('isValidHttpUrl rejects invalid URL', () => {
  assert(isValidHttpUrl('not-a-url') === false);
});

// ============================================
// 2. ID Generation
// ============================================
console.log('\n--- ID Generation ---');

test('generateSamplingRequestId returns unique IDs', () => {
  const id1 = generateSamplingRequestId();
  const id2 = generateSamplingRequestId();
  assert(id1 !== id2, 'IDs should be unique');
  assert(id1.startsWith('sampling-'), 'Should start with sampling-');
});

test('generateElicitationRequestId returns unique IDs', () => {
  const id1 = generateElicitationRequestId();
  const id2 = generateElicitationRequestId();
  assert(id1 !== id2, 'IDs should be unique');
  assert(id1.startsWith('elicitation-'), 'Should start with elicitation-');
});

// ============================================
// 3. ServerConfig Repository
// ============================================
console.log('\n--- ServerConfig Repository ---');

test('ServerConfigRepository CRUD operations', async () => {
  const repo = createMemoryServerConfigRepository();

  // Create
  const config = await repo.create({
    name: 'Test Server',
    transport: 'http',
    url: 'http://localhost:3000/mcp',
    connectionMode: 'direct',
  });
  assert(config.id, 'Should have generated ID');
  assert(config.name === 'Test Server', 'Name should match');
  assert(config.createdAt, 'Should have createdAt');

  // List
  const list = await repo.list();
  assert(list.length === 1, 'Should have 1 config');

  // Get
  const fetched = await repo.get(config.id);
  assert(fetched?.name === 'Test Server', 'Get should return config');

  // Update
  const updated = await repo.update(config.id, { name: 'Updated Server' });
  assert(updated.name === 'Updated Server', 'Name should be updated');
  assert(updated.updatedAt, 'Should have updatedAt');

  // Delete
  await repo.delete(config.id);
  const afterDelete = await repo.list();
  assert(afterDelete.length === 0, 'Should be empty after delete');
});

// ============================================
// 4. History Repository
// ============================================
console.log('\n--- History Repository ---');

test('HistoryRepository with parent-child relationships', async () => {
  const repo = createMemoryHistoryRepository();

  // Create parent entry (tool call)
  const parent = await repo.add({
    method: 'tools/call',
    target: 'test_tool',
    params: { arg: 'value' },
    response: { result: 'success' },
    duration: 100,
    success: true,
    requestType: 'primary',
  });
  assert(parent.id, 'Parent should have ID');

  // Create child entry (sampling request)
  const child = await repo.add({
    method: 'sampling/createMessage',
    target: 'claude-3-sonnet',
    params: { messages: [] },
    response: { content: 'response' },
    duration: 50,
    success: true,
    requestType: 'client',
    parentRequestId: parent.id,
    relativeTime: 25,
  });

  // Get children
  const children = await repo.getChildren(parent.id);
  assert(children.length === 1, 'Should have 1 child');
  assert(children[0].parentRequestId === parent.id, 'Child should reference parent');

  // List with rootOnly
  const rootOnly = await repo.list({ rootOnly: true });
  assert(rootOnly.length === 1, 'Should only return parent');
  assert(rootOnly[0].id === parent.id, 'Should be the parent');

  // Delete all but keep pinned
  await repo.update(parent.id, { pinned: true });
  await repo.deleteAll({ keepPinned: true });
  const afterDelete = await repo.list();
  assert(afterDelete.length === 1, 'Pinned entry should remain');
});

// ============================================
// 5. Logs Repository
// ============================================
console.log('\n--- Logs Repository ---');

test('LogsRepository with request correlation', async () => {
  const repo = createMemoryLogsRepository();

  const requestId = 'req-123';

  // Add logs for a request
  await repo.add({
    level: 'info',
    message: 'Starting request',
    logger: 'connection',
    requestId,
  });

  await repo.add({
    level: 'debug',
    message: 'Processing data',
    logger: 'tools',
    requestId,
  });

  await repo.add({
    level: 'info',
    message: 'Unrelated log',
    logger: 'connection',
  });

  // Get logs for request
  const requestLogs = await repo.getForRequest(requestId);
  assert(requestLogs.length === 2, 'Should have 2 logs for request');

  // Filter by level
  const debugOnly = await repo.list({ minLevel: 'debug' });
  assert(debugOnly.every(l => LOG_LEVELS.indexOf(l.level) >= LOG_LEVELS.indexOf('debug')));

  // Batch add
  const batch = await repo.addBatch([
    { level: 'warning', message: 'Warning 1', logger: 'test' },
    { level: 'error', message: 'Error 1', logger: 'test' },
  ]);
  assert(batch.length === 2, 'Batch should add 2 logs');
});

// ============================================
// 6. Testing Profile Repository
// ============================================
console.log('\n--- Testing Profile Repository ---');

test('TestingProfileRepository operations', async () => {
  const repo = createMemoryTestingProfileRepository();

  // Create profile
  const profile = await repo.create({
    name: 'Auto Mock',
    description: 'Automatic mock responses',
    samplingProvider: 'mock',
    autoRespond: true,
    defaultResponse: 'Mock response',
    defaultModel: 'mock-model',
    defaultStopReason: 'endTurn',
    modelOverrides: [
      { pattern: 'claude-*', response: 'Claude mock response' },
    ],
  });
  assert(profile.id, 'Should have ID');

  // List
  const list = await repo.list();
  assert(list.length === 1, 'Should have 1 profile');

  // Update
  await repo.update(profile.id, { autoRespond: false });
  const updated = await repo.get(profile.id);
  assert(updated?.autoRespond === false, 'autoRespond should be updated');
});

// ============================================
// 7. Connection Service
// ============================================
console.log('\n--- Connection Service ---');

test('ConnectionService state management', async () => {
  const service = createMemoryConnectionService();

  // Initial state
  let state = service.getState();
  assert(state.status === 'disconnected', 'Initial status should be disconnected');
  assert(state.serverUrl === null, 'No server URL initially');

  // Subscribe to changes
  let notified = false;
  const unsubscribe = service.subscribe(() => {
    notified = true;
  });

  // Note: connect() would fail without real server, but we can test disconnect
  await service.disconnect();
  state = service.getState();
  assert(state.status === 'disconnected', 'Should stay disconnected');

  unsubscribe();
});

// ============================================
// 8. Execution Service
// ============================================
console.log('\n--- Execution Service ---');

test('ExecutionService pending requests', () => {
  const service = createMemoryExecutionService();

  // Initial state
  let state = service.getState();
  assert(state.isExecuting === false, 'Not executing initially');
  assert(state.pendingClientRequests.length === 0, 'No pending requests');

  // Start execution
  service.startExecution('req-001');
  state = service.getState();
  assert(state.isExecuting === true, 'Should be executing');
  assert(state.currentRequestId === 'req-001', 'Should have request ID');

  // Add pending request
  service.addPendingRequest({
    id: 'sampling-001',
    type: 'sampling',
    request: {
      messages: [{ role: 'user', content: { type: 'text', text: 'Hello' } }],
    },
    parentRequestId: 'req-001',
    status: 'pending',
    timestamp: new Date().toISOString(),
  });
  state = service.getState();
  assert(state.pendingClientRequests.length === 1, 'Should have 1 pending request');

  // Resolve pending request
  service.resolvePendingRequest('sampling-001');
  state = service.getState();
  assert(state.pendingClientRequests[0].status === 'resolved', 'Should be resolved');

  // End execution (doesn't clear pending requests - that's separate)
  service.endExecution();
  state = service.getState();
  assert(state.isExecuting === false, 'Should not be executing');
  assert(state.currentRequestId === null, 'Request ID should be null');

  // Clear pending requests explicitly
  service.clearPendingRequests();
  state = service.getState();
  assert(state.pendingClientRequests.length === 0, 'Pending requests cleared after clearPendingRequests()');
});

// ============================================
// 9. MCP Client Creation
// ============================================
console.log('\n--- MCP Client Creation ---');

test('createMcpClient returns client instance', () => {
  const client = createMcpClient({
    name: 'Test Inspector',
    version: '1.0.0',
  });
  assert(client, 'Should return client instance');
  // Can't test connect without actual server
});

// ============================================
// 10. Type Helpers
// ============================================
console.log('\n--- Type Helpers ---');

test('createServerConfig helper', () => {
  const config = createServerConfig({
    name: 'My Server',
    transport: 'http',
    url: 'http://localhost:3000/mcp',
  });
  assert(config.connectionMode === 'direct', 'Default connectionMode should be direct');
});

test('createHistoryEntry helper', () => {
  const entry = createHistoryEntry({
    method: 'tools/call',
    target: 'echo',
    success: true,
    duration: 100,
  });
  assert(entry.id, 'Should generate ID');
  assert(entry.timestamp, 'Should generate timestamp');
  assert(entry.pinned === false, 'Default pinned should be false');
  assert(entry.method === 'tools/call', 'Method should match');
});

test('createLogEntry helper', () => {
  const entry = createLogEntry({
    level: 'info',
    message: 'Test log',
  });
  assert(entry.timestamp, 'Should have timestamp');
});

test('LOG_LEVELS array has 8 RFC 5424 levels', () => {
  assert(LOG_LEVELS.length === 8, 'Should have 8 levels');
  assert(LOG_LEVELS.includes('debug'), 'Should include debug');
  assert(LOG_LEVELS.includes('emergency'), 'Should include emergency');
});

// ============================================
// Summary
// ============================================
console.log('\n=== Test Summary ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total:  ${passed + failed}`);

process.exit(failed > 0 ? 1 : 0);
