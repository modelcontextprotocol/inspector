/**
 * Manual test script for inspector-core package
 * Run with: node test-core.js
 *
 * Note: Memory repositories and services were removed (2026-01-21).
 * Repository interfaces remain as contracts for proxy API implementations.
 * Connection/execution state is managed by UI-specific patterns (React Context).
 */

import {
  // Utilities
  isValidHttpUrl,
  generateSamplingRequestId,
  generateElicitationRequestId,

  // Client (can create, but not connect without server)
  createMcpClient,

  // Type helpers
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
// 3. MCP Client Creation
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
// 4. Type Helpers
// ============================================
console.log('\n--- Type Helpers ---');

test('createServerConfig helper', () => {
  const config = createServerConfig({
    name: 'My Server',
    transport: 'http',
    url: 'http://localhost:3000/mcp',
  });
  assert(config.connectionMode === 'direct', 'Default connectionMode should be direct');
  assert(config.id, 'Should have generated ID');
  assert(config.createdAt, 'Should have createdAt timestamp');
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
  // createLogEntry(level, message, logger, requestId?, parentRequestId?)
  const entry = createLogEntry('info', 'Test log', 'test-logger');
  assert(entry.timestamp, 'Should have timestamp');
  assert(entry.level === 'info', 'Level should match');
  assert(entry.message === 'Test log', 'Message should match');
  assert(entry.logger === 'test-logger', 'Logger should match');
});

test('LOG_LEVELS array has 8 RFC 5424 levels', () => {
  assert(LOG_LEVELS.length === 8, 'Should have 8 levels');
  assert(LOG_LEVELS.includes('debug'), 'Should include debug');
  assert(LOG_LEVELS.includes('emergency'), 'Should include emergency');
});

// ============================================
// 5. Repository Interfaces (type-only checks)
// ============================================
console.log('\n--- Repository Interfaces ---');

test('Repository interfaces are exported as types', () => {
  // These are type-only exports, we can verify they exist by importing
  // The actual implementations will be provided by proxy API or UI mocks
  console.log('       (Repository interfaces are type-only exports for proxy API contracts)');
});

// ============================================
// Summary
// ============================================
console.log('\n=== Test Summary ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total:  ${passed + failed}`);

process.exit(failed > 0 ? 1 : 0);
