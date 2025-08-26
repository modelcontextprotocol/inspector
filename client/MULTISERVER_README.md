# Multi-Server Support Implementation

This document provides comprehensive documentation for the multi-server support feature in the MCP Inspector client application.

## Overview

The multi-server support allows users to manage and interact with multiple MCP (Model Context Protocol) servers simultaneously. Users can switch between single-server mode (original functionality) and multi-server mode through a toggle in the sidebar.

## Architecture

### Core Components

#### 1. Types (`src/types/multiserver.ts`)

- **ServerConfig**: Configuration for individual servers
- **ServerConnection**: Active connection state and client instance
- **ServerStatus**: Connection status tracking
- **API Types**: Request/response interfaces for backend communication

#### 2. State Management

##### `useMultiServer` Hook (`src/lib/hooks/useMultiServer.ts`)

- Manages global multi-server state
- Handles server CRUD operations
- Provides connection management
- Integrates with backend API

##### `useServerConnection` Hook (`src/lib/hooks/useServerConnection.ts`)

- Manages individual server connections
- Handles connection lifecycle (connect/disconnect)
- Provides MCP client communication methods
- Tracks connection status and errors

#### 3. API Service (`src/services/multiServerApi.ts`)

- RESTful API client for backend communication
- Server management endpoints
- Connection management endpoints
- Error handling and response processing

#### 4. UI Components

##### Core Components

- **MultiServerDashboard**: Main container for multi-server interface
- **ServerList**: Displays list of configured servers
- **ServerCard**: Individual server display with status and actions
- **AddServerForm**: Form for creating new server configurations
- **ServerConfigModal**: Modal for editing server configurations
- **ModeToggle**: Switch between single and multi-server modes

##### Integration Components

- **ServerSpecificTabs**: Server-specific resource/tool/prompt tabs
- **Updated Sidebar**: Includes mode toggle and server management

## Features

### Server Management

- **Add Servers**: Support for stdio and HTTP transport types
- **Edit Servers**: Modify server configurations
- **Delete Servers**: Remove server configurations
- **Test Connections**: Validate server configurations before saving

### Connection Management

- **Connect/Disconnect**: Individual server connection control
- **Status Tracking**: Real-time connection status updates
- **Error Handling**: Comprehensive error reporting and recovery
- **Auto-reconnect**: Automatic connection attempts on component mount

### Transport Support

- **Stdio Transport**: Local command execution
  - Command and arguments configuration
  - Environment variables support
- **HTTP Transport**: Remote server connections
  - URL and headers configuration
  - Bearer token authentication
  - OAuth client configuration

### User Interface

- **Mode Toggle**: Seamless switching between single and multi-server modes
- **Server Cards**: Visual server status with connection indicators
- **Form Validation**: Comprehensive input validation with error messages
- **Responsive Design**: Mobile-friendly interface
- **Accessibility**: ARIA labels and keyboard navigation support

## Usage

### Switching to Multi-Server Mode

1. Open the application
2. In the sidebar, locate the "Mode" section
3. Toggle from "Single Server" to "Multi Server"
4. The interface will switch to the multi-server dashboard

### Adding a New Server

1. In multi-server mode, click "Add Server"
2. Fill in the server details:
   - **Name**: Descriptive name for the server
   - **Description**: Optional description
   - **Transport Type**: Choose stdio or HTTP
3. Configure transport-specific settings:
   - **Stdio**: Command, arguments, environment variables
   - **HTTP**: URL, headers, authentication
4. Optionally test the connection
5. Click "Create Server"

### Managing Servers

- **Connect**: Click the connect button on a server card
- **Disconnect**: Click the disconnect button on connected servers
- **Edit**: Click the edit icon to modify server configuration
- **Delete**: Click the delete icon to remove a server
- **View Details**: Click on a server card to view detailed information

### Server Interaction

- **Resources**: View and interact with server-specific resources
- **Tools**: Execute tools on specific servers
- **Prompts**: Access server-specific prompts
- **Overview**: View server capabilities and configuration

## Implementation Details

### State Management Pattern

The implementation uses a custom hook pattern for state management:

```typescript
// Global multi-server state
const multiServerState = useMultiServer();

// Individual server connection
const serverConnection = useServerConnection({
  serverId: "server-id",
  server: serverConfig,
});
```

### Error Handling

Comprehensive error handling at multiple levels:

- **API Level**: HTTP error responses with detailed messages
- **Hook Level**: Connection and request error handling
- **Component Level**: User-friendly error display
- **Toast Notifications**: Real-time feedback for user actions

### Performance Considerations

- **Lazy Loading**: Components are loaded on demand
- **Connection Pooling**: Efficient connection management
- **State Optimization**: Minimal re-renders through careful state design
- **Memory Management**: Proper cleanup of connections and subscriptions

## Testing

### Unit Tests

- Component rendering and behavior
- Hook functionality and state management
- API service methods and error handling
- Utility functions and type validation

### Integration Tests

- Component interaction workflows
- State management integration
- API communication flows
- Error handling scenarios

### End-to-End Tests

- Complete user workflows
- Multi-server mode switching
- Server management operations
- Connection lifecycle testing

## Configuration

### Environment Variables

- `REACT_APP_API_BASE_URL`: Backend API base URL (default: `/api`)
- `REACT_APP_WS_URL`: WebSocket URL for real-time updates

### Backend Integration

The client expects the following backend endpoints:

- `GET /api/servers` - List servers
- `POST /api/servers` - Create server
- `PUT /api/servers/:id` - Update server
- `DELETE /api/servers/:id` - Delete server
- `POST /api/connections` - Connect to server
- `DELETE /api/connections/:id` - Disconnect from server
- `GET /api/connections` - List active connections

## Troubleshooting

### Common Issues

#### Connection Failures

- **Stdio Transport**: Verify command exists and is executable
- **HTTP Transport**: Check URL accessibility and authentication
- **Network Issues**: Verify network connectivity and firewall settings

#### UI Issues

- **Mode Toggle Not Working**: Check localStorage for saved preferences
- **Server Cards Not Updating**: Verify WebSocket connection for real-time updates
- **Form Validation Errors**: Check input formats and required fields

#### Performance Issues

- **Slow Loading**: Check network latency and server response times
- **Memory Usage**: Monitor connection cleanup and component unmounting
- **UI Responsiveness**: Verify efficient state updates and re-rendering

### Debug Mode

Enable debug logging by setting `localStorage.debug = 'mcp-inspector:*'` in browser console.

## Future Enhancements

### Planned Features

- **Server Groups**: Organize servers into logical groups
- **Bulk Operations**: Perform actions on multiple servers
- **Connection Presets**: Save and reuse connection configurations
- **Advanced Monitoring**: Server health and performance metrics
- **Import/Export**: Configuration backup and sharing

### API Extensions

- **WebSocket Support**: Real-time server status updates
- **Batch Operations**: Efficient multi-server operations
- **Server Discovery**: Automatic server detection on network
- **Health Checks**: Periodic server availability testing

## Contributing

### Development Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Start development server: `npm run dev`
4. Run tests: `npm test`

### Code Style

- Follow existing TypeScript and React patterns
- Use provided UI components from `src/components/ui/`
- Implement comprehensive error handling
- Add appropriate TypeScript types
- Include unit tests for new functionality

### Pull Request Guidelines

- Include comprehensive tests
- Update documentation
- Follow semantic commit messages
- Ensure build passes without warnings
- Test multi-server functionality thoroughly

## License

This implementation is part of the MCP Inspector project and follows the same license terms.
