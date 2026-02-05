/**
 * @anthropic/inspector-core
 *
 * Core MCP client logic for Inspector - no React dependencies.
 * This package can be used in CLI tools, test frameworks, or any JS environment.
 */

// Client lifecycle
export {
  createMcpClient,
  connectClient,
  disconnectClient,
  isClientConnected,
  serverSupports,
} from './client.js';
export type { McpClientOptions, ServerInfo } from './client.js';

// Transport creation
export {
  createHttpTransport,
  createAuthenticatedTransport,
  isValidHttpUrl,
} from './transport.js';

// Request handlers (sampling, elicitation)
export {
  setupSamplingHandler,
  setupElicitationHandler,
  resolveSamplingRequest,
  rejectSamplingRequest,
  resolveElicitationRequest,
  rejectElicitationRequest,
  generateSamplingRequestId,
  generateElicitationRequestId,
  clearAllPendingRequests,
  hasPendingSamplingRequests,
  hasPendingElicitationRequests,
} from './handlers.js';

// All types
export * from './types/index.js';

// Data layer interfaces and memory stubs
export * from './data/index.js';
