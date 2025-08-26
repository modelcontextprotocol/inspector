# Client-Side Multi-Server Support for MCP Inspector

This directory contains the complete client-side implementation of multi-server support for the MCP Inspector, enabling users to manage multiple MCP server configurations simultaneously with real-time updates, sophisticated error handling, and seamless integration.

## Overview

The client-side multi-server implementation provides:

- **Server Management UI**: Complete CRUD interface for server configurations
- **Real-time Dashboard**: Live status monitoring with statistics and error tracking
- **Connection Management**: Independent server connections with status tracking
- **Error Aggregation**: Sophisticated error handling with console interception
- **State Persistence**: LocalStorage-based state management with cache invalidation
- **Event Streaming**: Real-time updates via Server-Sent Events
- **Mode Switching**: Seamless toggle between single and multi-server modes
- **Transport Support**: Both STDIO and HTTP transport configurations
- **History Management**: Centralized notification and interaction history

## Architecture

### Directory Structure

```
client/src/components/multiserver/
├── hooks/                     # Custom React hooks
│   ├── useMultiServer.ts     # Main state management hook (600+ lines)
│   ├── useMultiServerErrors.ts # Error aggregation and management
│   ├── useMultiServerHistory.ts # History and notification management
│   └── useConsoleErrorInterception.ts # Console error capture
├── services/                  # API communication layer
│   └── multiServerApi.ts     # RESTful API client with deduplication
├── stores/                    # Centralized data stores
│   └── multiServerHistoryStore.ts # History and notification storage
├── types/                     # TypeScript definitions
│   └── multiserver.ts        # Comprehensive type definitions (200+ lines)
├── utils/                     # Utility functions and helpers
│   ├── stateManager.ts       # State persistence and merging
│   ├── eventStreamManager.ts # Real-time event handling
│   ├── requestDeduplicator.ts # Request optimization
│   ├── requestBatcher.ts     # Request batching optimization
│   ├── errorDeduplicator.ts  # Error filtering
│   ├── localStorage.ts       # Cache management
│   ├── consoleErrorInterceptor.ts # Console error capture
│   └── loggingLevelSync.ts   # Logging level synchronization
├── __tests__/                 # Unit tests
│   ├── MultiServerDashboard.test.tsx
│   └── cacheInvalidation.test.ts
└── [React Components]         # UI components (detailed below)
```

### Integration Points

**Modified Files:**

- `client/src/App.tsx` - Mode switching, multi-server integration, stderr handling
- `client/src/components/Sidebar.tsx` - Mode toggle, multi-server controls, logging

## Core Features

### 1. State Management (`useMultiServer` Hook)

The main hook provides comprehensive state management with 600+ lines of functionality:

```typescript
const {
  // State
  servers,
  statuses,
  connections,
  selectedServerId,
  isLoading,
  error,
  mode,

  // Server Management
  addServer,
  updateServer,
  deleteServer,

  // Connection Management
  connectToServer,
  disconnectFromServer,

  // Utilities
  selectServer,
  toggleMode,
  setServerLogLevel,
  getServer,
  getServerStatus,
  getServerConnection,
} = useMultiServer();
```

**Key Features:**

- **Initialization with Retry Logic**: Robust startup with exponential backoff
- **State Persistence**: LocalStorage integration with cache invalidation
- **Event Stream Integration**: Real-time updates via global event manager
- **Optimistic Updates**: Immediate UI feedback with error rollback
- **Connection Recovery**: Automatic retry and status verification
- **Console Error Interception**: Captures errors for debugging

### 2. API Communication (`MultiServerApi`)

RESTful API client with advanced features:

```typescript
// Server Management
await MultiServerApi.createServer(config);
await MultiServerApi.updateServer(serverId, updates);
await MultiServerApi.deleteServer(serverId);

// Connection Management
await MultiServerApi.connectServer(serverId);
await MultiServerApi.disconnectServer(serverId);

// MCP Operations (Production Mode Support)
await MultiServerApi.listResources(serverId, cursor);
await MultiServerApi.readResource(serverId, uri);
await MultiServerApi.listTools(serverId, cursor);
await MultiServerApi.callTool(serverId, name, args);
await MultiServerApi.listPrompts(serverId, cursor);
await MultiServerApi.getPrompt(serverId, name, args);
await MultiServerApi.sendPing(serverId);

// Real-time Events
const eventSource = await MultiServerApi.createEventStream(onEvent);
```

**Features:**

- **Request Deduplication**: Prevents duplicate API calls
- **Authentication Integration**: Seamless token management
- **Error Handling**: Comprehensive error types and recovery
- **Event Streaming**: Server-Sent Events for real-time updates
- **Production Mode Support**: HTTP API endpoints for MCP operations

### 3. Error Management (`useMultiServerErrors`)

Sophisticated error aggregation system:

```typescript
const {
  errorSummaries, // Per-server error summaries
  totalErrorCount, // Total error count across all servers
  consoleErrorCount, // Console-specific errors
  serverErrorCount, // Server-generated errors
  clearAllErrors, // Clear all error state
  clearServerErrors, // Clear errors for specific server
} = useMultiServerErrors();
```

**Features:**

- **Error Deduplication**: Prevents duplicate error entries
- **Console Interception**: Captures JavaScript console errors
- **Source Attribution**: Tracks error sources (console vs server)
- **Real-time Updates**: Live error count updates

### 4. History Management (`useMultiServerHistory`)

Centralized history and notification management:

```typescript
const {
  notifications, // All server notifications
  stdErrNotifications, // Error notifications
  getServerHistory, // Get history for specific server
  clearHistory, // Clear all history
  clearServerHistory, // Clear history for specific server
} = useMultiServerHistory();
```

## React Components

### Core Dashboard Components

#### `MultiServerDashboard`

Main container component with tabbed interface:

- **Overview Tab**: Statistics, quick actions, error summary
- **Servers Tab**: Server list with management controls
- **Monitoring Tab**: Health monitoring and status details
- **History Tab**: Centralized notification history

#### `ServerList`

Comprehensive server management interface:

- Server cards with status indicators
- Connection controls (connect/disconnect)
- CRUD operations (edit/delete)
- Bulk operations support

#### `ServerCard`

Individual server display component:

- Status badges with color coding
- Transport type indicators
- Quick action buttons
- Error state visualization

### Configuration Components

#### `AddServerForm`

Server creation form with validation:

- Transport type selection (STDIO/HTTP)
- Dynamic configuration fields
- Real-time validation
- Test connection functionality

#### `ServerConfigModal`

Server editing modal:

- Pre-populated form fields
- Configuration validation
- Save/cancel operations
- Error handling

#### `ModeToggle`

Single/multi-server mode switcher:

- Seamless mode transitions
- State preservation
- Visual mode indicators

### Specialized Components

#### `ServerSpecificTabs`

Individual server interaction interface:

- Resources, Tools, Prompts tabs
- Server-specific operations
- Connection status display
- Logging level controls

#### `ErrorSummaryCard`

Error aggregation display:

- Per-server error counts
- Latest error details
- Clear error actions
- Error source indicators

#### `ErrorBoundary`

React error boundary for fault tolerance:

- Graceful error handling
- Error reporting
- Component recovery

#### `MultiServerErrorOutput`

Error output display component:

- Real-time error streaming
- Error filtering and search
- Error source identification
- Clear error actions

#### `MultiServerHistoryAndNotifications`

History and notifications management interface:

- Centralized notification display
- Server-specific history filtering
- Notification categorization
- History export functionality

#### `ServerErrorDisplay`

Server-specific error display:

- Individual server error tracking
- Error severity indicators
- Error timestamp tracking
- Error details expansion

## Utility Functions

### State Management (`stateManager.ts`)

```typescript
// State persistence
persistMultiServerState(servers, statuses, selectedServerId);

// State restoration with validation
const state = restoreMultiServerState();

// State merging for API sync
const merged = mergeServerStates(apiServers, apiStatuses, localState);
```

### Event Streaming (`eventStreamManager.ts`)

```typescript
// Global event stream manager
const manager = globalEventStreamManager;

// Add event listener
const removeListener = manager.addListener(handleEvent);

// Track server logging levels
manager.trackServerLoggingLevel(serverId, level);
```

### Request Optimization (`requestDeduplicator.ts`)

```typescript
// Deduplicate API requests
const result = await globalRequestDeduplicator.deduplicateRequest(
  cacheKey,
  requestFn,
  cacheDuration,
);
```

### Error Management (`errorDeduplicator.ts`)

```typescript
// Deduplicate error notifications
const deduplicator = new ErrorDeduplicator();
const shouldAdd = deduplicator.shouldAddError(error);
```

### Console Interception (`consoleErrorInterceptor.ts`)

```typescript
// Set up console error capture
const interceptor = new ConsoleErrorInterceptorImpl();
interceptor.setup(serverName, onError);
```

## Type System

### Core Types (`multiserver.ts`)

**Server Configuration:**

```typescript
interface ServerConfig {
  id: string;
  name: string;
  description?: string;
  transportType: "stdio" | "streamable-http";
  config: StdioConfig | HttpConfig;
  createdAt: Date;
  updatedAt: Date;
}
```

**Connection State:**

```typescript
interface ServerConnection {
  id: string;
  client: Client | null;
  transport: Transport | null;
  capabilities: ServerCapabilities | null;
  resources: Resource[];
  tools: Tool[];
  prompts: Prompt[];
  logLevel: LoggingLevel;
  loggingSupported: boolean;
}
```

**Error Management:**

```typescript
interface MultiServerErrorState {
  serverErrors: Map<string, StdErrNotification[]>;
  errorSummaries: ServerErrorSummary[];
  totalErrorCount: number;
  consoleErrorCount: number;
  serverErrorCount: number;
}
```

## Integration with App.tsx

### Mode Switching

```typescript
// App mode state management
const [appMode, setAppMode] = useState<AppMode>("single-server");

// Handle mode changes
const handleAppModeChange = useCallback((newMode: AppMode) => {
  setAppMode(newMode);
  // Sync with localStorage for multi-server hook
}, []);
```

### Current Server Tracking

```typescript
// Track current server for sidebar integration
const handleCurrentServerChange = useCallback(
  (
    serverId: string | null,
    serverName: string | null,
    serverStatus: string | null,
  ) => {
    setCurrentMultiServerId(serverId);
    setCurrentMultiServerName(serverName);
    setCurrentMultiServerStatus(serverStatus);
  },
  [],
);
```

### Logging Integration

```typescript
// Multi-server logging level management
const handleMultiServerLogLevelChange = useCallback(
  async (serverId: string, level: LoggingLevel) => {
    await setServerLogLevel(serverId, level);
  },
  [setServerLogLevel],
);
```

## Testing

### Unit Tests

- **Hook Testing**: `useMultiServer.test.tsx` - State management and API integration
- **Component Testing**: `MultiServerDashboard.test.tsx` - UI interactions
- **Utility Testing**: `cacheInvalidation.test.ts` - Cache management logic

### Test Coverage

- State persistence and restoration
- API error handling and recovery
- Event stream management
- Error deduplication
- Console error interception
- Cache invalidation logic

## Development Guidelines

### Adding New Features

1. **Types First**: Define TypeScript interfaces in `types/multiserver.ts`
2. **API Integration**: Add endpoints to `MultiServerApi` class
3. **State Management**: Update `useMultiServer` hook for state changes
4. **UI Components**: Create React components with proper error boundaries
5. **Testing**: Add comprehensive unit tests

### Error Handling

- Use `MultiServerApiError` for API-related errors
- Implement error boundaries for component fault tolerance
- Provide user-friendly error messages with toast notifications
- Log detailed error information for debugging

### Performance Considerations

- Request deduplication prevents duplicate API calls
- Event stream management optimizes real-time updates
- LocalStorage caching reduces API load
- Optimistic updates improve perceived performance

### State Persistence

- All server configurations persist to LocalStorage
- Cache invalidation ensures data consistency
- State merging handles API/localStorage synchronization
- Version management prevents data corruption

## Contributing

When contributing to the multi-server functionality:

1. **Follow TypeScript Best Practices**: Use strict typing and proper interfaces
2. **Maintain Test Coverage**: Add tests for new functionality
3. **Handle Errors Gracefully**: Implement proper error boundaries and recovery
4. **Document Changes**: Update this README for significant changes
5. **Preserve Backward Compatibility**: Ensure single-server mode continues working

## Dependencies

**Core Dependencies:**

- `@modelcontextprotocol/sdk` - MCP client and type definitions
- React hooks ecosystem - State management and lifecycle
- `@radix-ui` components - UI component library via shadcn/ui

**Integration Dependencies:**

- `client/src/utils/configUtils` - Configuration management
- `client/src/lib/hooks/useToast` - Toast notifications
- `client/src/components/ui/*` - UI component library

**No Additional npm Packages Required** - Uses existing MCP SDK and UI components.
