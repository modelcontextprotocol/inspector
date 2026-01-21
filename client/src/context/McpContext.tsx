/**
 * MCP Context - Manage MCP client connection state for React
 *
 * This context provides:
 * - Connection state management (disconnected, connecting, connected, error)
 * - Client reference for MCP operations
 * - Server info and capabilities
 * - Connect/disconnect methods
 *
 * Usage:
 *   import { McpProvider, useMcp } from '@/context/McpContext';
 *
 *   // Wrap app with provider
 *   <McpProvider>
 *     <App />
 *   </McpProvider>
 *
 *   // Use in components
 *   const { connect, disconnect, connectionState, serverInfo } = useMcp();
 */

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  createMcpClient,
  connectClient,
  disconnectClient,
  createHttpTransport,
  createAuthenticatedTransport,
  type ServerInfo,
  type McpClientOptions,
} from '@modelcontextprotocol/inspector-core';

// Connection state
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

// Connection options for HTTP servers
export interface ConnectionOptions {
  /** Custom headers to send with requests */
  headers?: Record<string, string>;
  /** Bearer token for authentication */
  token?: string;
  /** Client options (name, version, capabilities) */
  clientOptions?: McpClientOptions;
}

// Error info
export interface ConnectionError {
  message: string;
  code?: string;
  timestamp: string;
}

// MCP state
interface McpState {
  connectionState: ConnectionState;
  serverUrl: string | null;
  serverInfo: ServerInfo | null;
  error: ConnectionError | null;
}

// Actions
type McpAction =
  | { type: 'CONNECT_START'; url: string }
  | { type: 'CONNECT_SUCCESS'; serverInfo: ServerInfo }
  | { type: 'CONNECT_ERROR'; error: ConnectionError }
  | { type: 'DISCONNECT' };

// Initial state
const initialState: McpState = {
  connectionState: 'disconnected',
  serverUrl: null,
  serverInfo: null,
  error: null,
};

// Reducer
function mcpReducer(state: McpState, action: McpAction): McpState {
  switch (action.type) {
    case 'CONNECT_START':
      return {
        ...state,
        connectionState: 'connecting',
        serverUrl: action.url,
        error: null,
      };

    case 'CONNECT_SUCCESS':
      return {
        ...state,
        connectionState: 'connected',
        serverInfo: action.serverInfo,
        error: null,
      };

    case 'CONNECT_ERROR':
      return {
        ...state,
        connectionState: 'error',
        serverInfo: null,
        error: action.error,
      };

    case 'DISCONNECT':
      return {
        ...initialState,
      };

    default:
      return state;
  }
}

// Context value interface
interface McpContextValue {
  // State
  connectionState: ConnectionState;
  serverUrl: string | null;
  serverInfo: ServerInfo | null;
  error: ConnectionError | null;
  client: Client | null;

  // Actions
  connect: (url: string, options?: ConnectionOptions) => Promise<void>;
  disconnect: () => Promise<void>;

  // Helpers
  isConnected: boolean;
  canExecute: boolean;
}

// Context
const McpContext = createContext<McpContextValue | null>(null);

// Provider props
interface McpProviderProps {
  children: ReactNode;
}

/**
 * MCP Provider - Wrap your app with this to enable MCP functionality.
 */
export function McpProvider({ children }: McpProviderProps) {
  const [state, dispatch] = useReducer(mcpReducer, initialState);
  const clientRef = useRef<Client | null>(null);

  /**
   * Connect to an MCP server.
   */
  const connect = useCallback(async (url: string, options: ConnectionOptions = {}) => {
    // Don't connect if already connecting/connected
    if (state.connectionState === 'connecting' || state.connectionState === 'connected') {
      console.warn('[MCP] Already connected or connecting');
      return;
    }

    dispatch({ type: 'CONNECT_START', url });

    try {
      // Create client
      const client = createMcpClient(options.clientOptions);
      clientRef.current = client;

      // Create transport based on options
      const transport = options.token
        ? createAuthenticatedTransport(url, options.token)
        : createHttpTransport(url, options.headers);

      // Connect
      const serverInfo = await connectClient(client, transport);

      dispatch({ type: 'CONNECT_SUCCESS', serverInfo });

      console.log('[MCP] Connected to server:', serverInfo.name, serverInfo.version);
      if (serverInfo.instructions) {
        console.log('[MCP] Server instructions:', serverInfo.instructions);
      }
    } catch (err) {
      const error: ConnectionError = {
        message: err instanceof Error ? err.message : 'Unknown connection error',
        code: (err as { code?: string })?.code,
        timestamp: new Date().toISOString(),
      };

      dispatch({ type: 'CONNECT_ERROR', error });
      clientRef.current = null;

      console.error('[MCP] Connection failed:', error.message);
    }
  }, [state.connectionState]);

  /**
   * Disconnect from the current MCP server.
   */
  const disconnect = useCallback(async () => {
    if (clientRef.current) {
      try {
        await disconnectClient(clientRef.current);
      } catch (err) {
        console.warn('[MCP] Error during disconnect:', err);
      }
      clientRef.current = null;
    }

    dispatch({ type: 'DISCONNECT' });
    console.log('[MCP] Disconnected');
  }, []);

  // Computed values
  const isConnected = state.connectionState === 'connected';
  const canExecute = isConnected && clientRef.current !== null;

  const value: McpContextValue = {
    // State
    connectionState: state.connectionState,
    serverUrl: state.serverUrl,
    serverInfo: state.serverInfo,
    error: state.error,
    client: clientRef.current,

    // Actions
    connect,
    disconnect,

    // Helpers
    isConnected,
    canExecute,
  };

  return <McpContext.Provider value={value}>{children}</McpContext.Provider>;
}

/**
 * Hook to access MCP context.
 */
export function useMcp(): McpContextValue {
  const context = useContext(McpContext);
  if (!context) {
    throw new Error('useMcp must be used within an McpProvider');
  }
  return context;
}

/**
 * Hook to get just the connection state.
 */
export function useConnectionState(): ConnectionState {
  const { connectionState } = useMcp();
  return connectionState;
}

/**
 * Hook to get server info if connected.
 */
export function useServerInfo(): ServerInfo | null {
  const { serverInfo } = useMcp();
  return serverInfo;
}

/**
 * Hook to check if a specific capability is supported.
 */
export function useServerCapability(capability: string): boolean {
  const { serverInfo } = useMcp();
  if (!serverInfo?.capabilities) return false;
  return capability in serverInfo.capabilities;
}
