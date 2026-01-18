// MCP library exports
export {
  createHttpTransport,
  createAuthenticatedTransport,
  isValidHttpUrl,
} from './transport';

export {
  createMcpClient,
  connectClient,
  disconnectClient,
  isClientConnected,
  serverSupports,
  type McpClientOptions,
  type ServerInfo,
} from './client';

export {
  setupSamplingHandler,
  setupElicitationHandler,
  resolveSamplingRequest,
  rejectSamplingRequest,
  resolveElicitationRequest,
  rejectElicitationRequest,
  clearAllPendingRequests,
  hasPendingSamplingRequests,
  hasPendingElicitationRequests,
  generateSamplingRequestId,
  generateElicitationRequestId,
  type SamplingHandlerCallbacks,
  type ElicitationHandlerCallbacks,
} from './handlers';
