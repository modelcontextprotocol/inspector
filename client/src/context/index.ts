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
