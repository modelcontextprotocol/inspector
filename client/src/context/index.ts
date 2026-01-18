// Re-export context providers and hooks
// NOTE: Storage contexts (ServerConfig, History, Logs) are not included
// pending storage decision per issue #983. Pages use mock data for now.

export {
  McpProvider,
  useMcp,
  useConnectionState,
  useServerInfo,
  useServerCapability,
  type ConnectionState,
  type ConnectionOptions,
  type ConnectionError,
} from './McpContext';

export {
  ExecutionProvider,
  useExecution,
  useActiveProfile,
  usePendingRequestsCount,
  useCurrentPendingRequest,
  useResolvedRequestsCount,
  generateRequestId,
  generateClientRequestId,
  type ExecutionState,
  type ExecutionAction,
  type PendingClientRequest,
  type ClientRequestType,
  type ClientRequestStatus,
  type ExecutionProgress,
} from './ExecutionContext';
