# Multi-Server Support for MCP Inspector

This directory contains the implementation of multi-server support for the MCP Inspector, allowing users to manage multiple MCP server configurations simultaneously with real-time updates and centralized communication.

## Overview

The multi-server implementation extends the existing MCP Inspector with:

- **Server Management**: Create, read, update, and delete multiple server configurations
- **Connection Management**: Connect to and disconnect from multiple servers independently
- **MCP Proxy**: Unified API for communicating with individual servers
- **Real-time Events**: Server-Sent Events for live status updates and notifications
- **Logging Management**: Centralized logging level synchronization across servers
- **Transport Support**: Both STDIO and HTTP transport types
- **Backward Compatibility**: Existing single-server functionality remains unchanged

## Architecture

### Directory Structure

```
server/src/multiserver/
├── models/                 # Type definitions and data models
│   ├── types.ts           # Core TypeScript interfaces and Zod schemas
│   ├── ServerConfig.ts    # Server configuration model
│   └── ServerStatus.ts    # Connection status model
├── services/              # Business logic services
│   ├── ServerManager.ts   # Server CRUD operations
│   ├── ConnectionManager.ts # Connection lifecycle management
│   └── EventStreamService.ts # Real-time event streaming service
├── utils/                 # Utility functions
│   ├── idGenerator.ts     # Unique ID generation
│   ├── transportFactory.ts # Transport creation factory
│   └── loggingLevelManager.ts # Centralized logging level state management
├── middleware/            # Express middleware
│   ├── auth.ts           # Authentication middleware
│   ├── validation.ts     # Request validation middleware
│   └── errorHandler.ts   # Error handling middleware
├── routes/               # REST API endpoints
│   ├── servers.ts        # Server management endpoints
│   ├── connections.ts    # Connection management endpoints
│   ├── mcp-proxy.ts      # MCP request proxy endpoints
│   └── events.ts         # Server-Sent Events endpoint
├── mock-servers/         # Mock servers for testing
│   ├── stdio/           # STDIO mock server
│   ├── http/            # HTTP mock server
│   └── index.ts         # Mock server utilities
└── __tests__/           # Test files
    ├── services/        # Service unit tests
    ├── http/           # HTTP API test files
    └── loggingLevelSync.test.ts # Logging level synchronization tests
```

### New Features

#### 1. MCP Proxy (`routes/mcp-proxy.ts`)

Provides unified API endpoints for communicating with individual MCP servers without direct client connections.

**Why needed**: Enables the web interface to interact with multiple servers through a single API, avoiding CORS issues and connection management complexity.

**Endpoints**:

- `POST /api/mcp/:id/request` - Generic MCP request proxy
- `GET /api/mcp/:id/resources` - List server resources
- `GET /api/mcp/:id/tools` - List server tools
- `GET /api/mcp/:id/prompts` - List server prompts
- `GET /api/mcp/:id/capabilities` - Get server capabilities

#### 2. Event Streaming (`routes/events.ts`, `services/EventStreamService.ts`)

Real-time Server-Sent Events for live updates and notifications across all connected servers.

**Purpose**: Provides instant feedback on server status changes, connection events, and notifications without polling.

**Endpoints**:

- `GET /api/events` - Subscribe to real-time event stream
- `GET /api/events/stats` - Get event stream statistics

**Event Types**: `status_change`, `connection_change`, `notification`, `stderr_notification`

#### 3. Logging Level Management (`utils/loggingLevelManager.ts`)

Centralized system for tracking and synchronizing logging levels across all servers with timeout handling and queue management.

**Purpose**: Ensures consistent logging behavior and handles rapid level changes with proper cleanup.

#### 4. Enhanced Integration (`server/src/index.ts`)

Main server now includes all multiserver routes with proper authentication and middleware integration.

**New Routes Added**:

- `/api/servers` - Server management
- `/api/connections` - Connection management
- `/api/events` - Event streaming
- `/api/mcp` - MCP proxy

## Usage

### Starting the Server

```bash
cd server
npm run dev
```

Server starts on `http://localhost:6277` with multi-server API at `/api/*` endpoints.

### Creating Server Configurations

#### STDIO Server

```bash
curl -X POST http://localhost:6277/api/servers \
  -H "Content-Type: application/json" \
  -H "x-mcp-proxy-auth: Bearer YOUR_TOKEN" \
  -d '{
    "name": "My STDIO Server",
    "description": "A server using STDIO transport",
    "transportType": "stdio",
    "config": {
      "command": "node",
      "args": ["my-server.js"],
      "env": {"NODE_ENV": "development"}
    }
  }'
```

#### HTTP Server

```bash
curl -X POST http://localhost:6277/api/servers \
  -H "Content-Type: application/json" \
  -H "x-mcp-proxy-auth: Bearer YOUR_TOKEN" \
  -d '{
    "name": "My HTTP Server",
    "description": "A server using HTTP transport",
    "transportType": "streamable-http",
    "config": {"url": "http://localhost:3000/mcp"}
  }'
```

### Using MCP Proxy

#### Connect to Server

```bash
curl -X POST http://localhost:6277/api/connections/{server-id}/connect \
  -H "x-mcp-proxy-auth: Bearer YOUR_TOKEN"
```

#### Make MCP Request via Proxy

```bash
curl -X POST http://localhost:6277/api/mcp/{server-id}/request \
  -H "Content-Type: application/json" \
  -H "x-mcp-proxy-auth: Bearer YOUR_TOKEN" \
  -d '{"method": "tools/list"}'
```

#### Get Server Resources

```bash
curl http://localhost:6277/api/mcp/{server-id}/resources \
  -H "x-mcp-proxy-auth: Bearer YOUR_TOKEN"
```

### Real-time Events

#### Subscribe to Event Stream

```bash
curl -N http://localhost:6277/api/events?MCP_PROXY_AUTH_TOKEN=YOUR_TOKEN \
  -H "Accept: text/event-stream"
```

Events are streamed as JSON with types: `status_change`, `connection_change`, `notification`, `stderr_notification`.

## API Reference

### Core Endpoints

**Server Management** (`/api/servers`)

- `GET /api/servers` - List all servers
- `POST /api/servers` - Create server
- `GET /api/servers/:id` - Get server by ID
- `PUT /api/servers/:id` - Update server
- `DELETE /api/servers/:id` - Delete server

**Connection Management** (`/api/connections`)

- `GET /api/connections` - Get all connection statuses
- `GET /api/connections/:id` - Get connection status
- `POST /api/connections/:id/connect` - Connect to server
- `POST /api/connections/:id/disconnect` - Disconnect from server
- `POST /api/connections/disconnect-all` - Disconnect all

**MCP Proxy** (`/api/mcp`)

- `POST /api/mcp/:id/request` - Generic MCP request
- `GET /api/mcp/:id/resources` - List resources
- `GET /api/mcp/:id/tools` - List tools
- `GET /api/mcp/:id/prompts` - List prompts
- `GET /api/mcp/:id/capabilities` - Get capabilities

**Event Streaming** (`/api/events`)

- `GET /api/events` - Subscribe to event stream
- `GET /api/events/stats` - Get stream statistics

### Authentication

All API endpoints require authentication via:

- Header: `x-mcp-proxy-auth: Bearer YOUR_TOKEN`
- Query param: `?MCP_PROXY_AUTH_TOKEN=YOUR_TOKEN` (for EventSource)

Token is displayed in console on server startup or set via `MCP_PROXY_AUTH_TOKEN` environment variable.

## Testing

### Unit Tests

```bash
cd server
npm test
```

**Test Coverage**:

- ServerManager: 18 tests (CRUD, validation, error handling)
- ConnectionManager: 22 tests (lifecycle, status, errors)
- LoggingLevelManager: Synchronization and cleanup tests

### HTTP API Testing

Use `.http` files in `__tests__/http/` with REST Client extension:

- `servers.http` - Server management
- `connections.http` - Connection management

## Configuration

### Environment Variables

- `NODE_ENV` - Environment mode
- `SERVER_PORT` - Server port (default: 6277)
- `MCP_PROXY_AUTH_TOKEN` - Authentication token
- `DANGEROUSLY_OMIT_AUTH` - Disable authentication (not recommended)
- `ALLOWED_ORIGINS` - Comma-separated allowed origins

### Transport Configuration

- **STDIO**: `{command, args, env}`
- **HTTP**: `{url}`

## Error Handling

Comprehensive error handling includes:

- **Validation**: Zod schema validation with detailed messages
- **Connection**: Transport failures with retry logic
- **Authentication**: Secure token-based auth with timing-safe comparison
- **Not Found**: Proper 404 responses
- **Server Errors**: 500 responses with logging

## Security

- Input validation using Zod schemas
- Authentication middleware with timing-safe token comparison
- Origin validation to prevent DNS rebinding attacks
- Error message sanitization
- Resource cleanup on shutdown

## Performance

- In-memory storage (suitable for development)
- Connection pooling for efficient resource management
- Lazy connection establishment
- Automatic cleanup of expired logging level updates
- Event stream client management with error handling

## Backward Compatibility

Full backward compatibility maintained:

- Existing single-server endpoints unchanged
- No breaking changes to API contracts
- Existing client code continues working

## Contributing

When contributing:

1. Follow existing code structure and patterns
2. Add comprehensive tests for new functionality
3. Update documentation for API changes
4. Ensure backward compatibility
5. Use TypeScript best practices and Zod validation

For detailed API schemas and examples, see the HTTP test files in `__tests__/http/`.
