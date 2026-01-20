# Web Client Integration with InspectorClient - Analysis

## Current Web Client Architecture

### `useConnection` Hook Responsibilities

The web client's `useConnection` hook (`client/src/lib/hooks/useConnection.ts`) currently handles:

1. **Connection Management**
   - Connection status state (`disconnected`, `connecting`, `connected`, `error`, `error-connecting-to-proxy`)
   - Direct vs. proxy connection modes
   - Proxy health checking

2. **Transport Creation**
   - Creates SSE or StreamableHTTP transports directly
   - Handles proxy mode (connects to proxy server endpoints)
   - Handles direct mode (connects directly to MCP server)
   - Manages transport options (headers, fetch wrappers, reconnection options)

3. **OAuth Authentication**
   - Browser-based OAuth flow (authorization code flow)
   - OAuth token management via `InspectorOAuthClientProvider`
   - Session storage for OAuth tokens
   - OAuth callback handling
   - Token refresh

4. **Custom Headers**
   - Custom header management (migration from legacy auth)
   - Header validation
   - OAuth token injection into headers
   - Special header processing (`x-custom-auth-headers`)

5. **Request/Response Tracking**
   - Request history (`{ request: string, response?: string }[]`)
   - History management (`pushHistory`, `clearRequestHistory`)
   - Different format than InspectorClient's `MessageEntry[]`

6. **Notification Handling**
   - Notification handlers via callbacks (`onNotification`, `onStdErrNotification`)
   - Multiple notification schemas (Cancelled, Logging, ResourceUpdated, etc.)
   - Fallback notification handler

7. **Request Handlers**
   - Elicitation request handling (`onElicitationRequest`)
   - Pending request handling (`onPendingRequest`)
   - Roots request handling (`getRoots`)

8. **Completion Support**
   - Completion capability detection
   - Completion state management

9. **Progress Notifications**
   - Progress notification handling
   - Timeout reset on progress

10. **Session Management**
    - Session ID tracking (`mcpSessionId`)
    - Protocol version tracking (`mcpProtocolVersion`)
    - Response header capture

11. **Server Information**
    - Server capabilities
    - Server implementation info
    - Protocol version

12. **Error Handling**
    - Proxy auth errors
    - OAuth errors
    - Connection errors
    - Retry logic

### App.tsx State Management

The main `App.tsx` component manages:

- Resources, resource templates, resource content
- Prompts, prompt content
- Tools, tool results
- Errors per tab
- Connection configuration (command, args, sseUrl, transportType, etc.)
- OAuth configuration
- Custom headers
- Notifications
- Roots
- Environment variables
- Log level
- Active tab
- Pending requests
- And more...

## InspectorClient Capabilities

### What InspectorClient Provides

1. **Connection Management**
   - Connection status (`disconnected`, `connecting`, `connected`, `error`)
   - `connect()` and `disconnect()` methods
   - Automatic transport creation from `MCPServerConfig`

2. **Message Tracking**
   - Tracks all JSON-RPC messages (requests, responses, notifications)
   - `MessageEntry[]` format with timestamps, direction, duration
   - Event-driven updates (`message`, `messagesChange` events)

3. **Stderr Logging**
   - Captures stderr from stdio transports
   - `StderrLogEntry[]` format
   - Event-driven updates (`stderrLog`, `stderrLogsChange` events)

4. **Server Data Management**
   - Auto-fetches tools, resources, prompts (configurable)
   - Caches capabilities, serverInfo, instructions
   - Event-driven updates for all server data

5. **High-Level Methods**
   - `listTools()`, `callTool()` - with parameter conversion
   - `listResources()`, `readResource()`, `listResourceTemplates()`
   - `listPrompts()`, `getPrompt()` - with argument stringification
   - `setLoggingLevel()` - with capability checks

6. **Event-Driven Updates**
   - EventTarget-based events (cross-platform)
   - Events: `statusChange`, `connect`, `disconnect`, `error`, `toolsChange`, `resourcesChange`, `promptsChange`, `capabilitiesChange`, `serverInfoChange`, `instructionsChange`, `message`, `messagesChange`, `stderrLog`, `stderrLogsChange`

7. **Transport Abstraction**
   - Works with stdio, SSE, streamable-http
   - Creates transports from `MCPServerConfig`
   - Handles transport lifecycle

### What InspectorClient Doesn't Provide

1. **OAuth Authentication**
   - No OAuth flow handling
   - No token management
   - No OAuth callback handling

2. **Proxy Mode**
   - Doesn't handle proxy server connections
   - Doesn't handle proxy authentication
   - Doesn't construct proxy URLs

3. **Custom Headers**
   - Doesn't support custom headers in transport creation
   - Doesn't handle header validation
   - Doesn't inject OAuth tokens into headers

4. **Request History**
   - Uses `MessageEntry[]` format (different from web client's `{ request: string, response?: string }[]`)
   - Different tracking approach

5. **Completion Support**
   - No completion capability detection
   - No completion state management

6. **Elicitation Support**
   - No elicitation request handling

7. **Progress Notifications**
   - No progress notification handling
   - No timeout reset on progress

8. **Session Management**
   - No session ID tracking
   - No protocol version tracking

9. **Request Handlers**
   - No support for setting request handlers (elicitation, pending requests, roots)

10. **Direct vs. Proxy Mode**
    - Doesn't distinguish between direct and proxy connections
    - Doesn't handle proxy health checking

## Integration Challenges

### 1. OAuth Authentication

**Challenge**: InspectorClient doesn't handle OAuth. The web client needs browser-based OAuth flow.

**Options**:

- **Option A**: Keep OAuth handling in web client, inject tokens into transport config
- **Option B**: Extend InspectorClient to accept OAuth provider/callback
- **Option C**: Create a web-specific wrapper around InspectorClient

**Recommendation**: Option A - Keep OAuth in web client, pass tokens via custom headers in `MCPServerConfig`.

### 2. Proxy Mode

**Challenge**: InspectorClient doesn't handle proxy mode. Web client connects through proxy server.

**Options**:

- **Option A**: Extend `MCPServerConfig` to support proxy mode
- **Option B**: Create proxy-aware transport factory
- **Option C**: Keep proxy handling in web client, construct proxy URLs before creating InspectorClient

**Recommendation**: Option C - Handle proxy URL construction in web client, pass final URL to InspectorClient.

### 3. Custom Headers

**Challenge**: InspectorClient's transport creation doesn't support custom headers.

**Options**:

- **Option A**: Extend `MCPServerConfig` to include custom headers
- **Option B**: Extend transport creation to accept headers
- **Option C**: Keep header handling in web client, pass via transport options

**Recommendation**: Option A - Add `headers` to `SseServerConfig` and `StreamableHttpServerConfig` in `MCPServerConfig`.

### 4. Request History Format

**Challenge**: Web client uses `{ request: string, response?: string }[]`, InspectorClient uses `MessageEntry[]`.

**Options**:

- **Option A**: Convert InspectorClient messages to web client format
- **Option B**: Update web client to use `MessageEntry[]` format
- **Option C**: Keep both, use InspectorClient for new features

**Recommendation**: Option B - Update web client to use `MessageEntry[]` format (more detailed, better for debugging).

### 5. Completion Support

**Challenge**: InspectorClient doesn't detect or manage completion support.

**Options**:

- **Option A**: Add completion support to InspectorClient
- **Option B**: Keep completion detection in web client
- **Option C**: Use capabilities to detect completion support

**Recommendation**: Option C - Check `capabilities.completions` from InspectorClient's `getCapabilities()`.

### 6. Elicitation Support

**Challenge**: InspectorClient doesn't support request handlers (elicitation, pending requests, roots).

**Options**:

- **Option A**: Add request handler support to InspectorClient
- **Option B**: Access underlying SDK Client via `getClient()` to set handlers
- **Option C**: Keep elicitation handling in web client

**Recommendation**: Option B - Use `inspectorClient.getClient()` to set request handlers (minimal change).

### 7. Progress Notifications

**Challenge**: InspectorClient doesn't handle progress notifications or timeout reset.

**Options**:

- **Option A**: Add progress notification handling to InspectorClient
- **Option B**: Handle progress in web client via notification callbacks
- **Option C**: Extend InspectorClient to support progress callbacks

**Recommendation**: Option B - Handle progress via existing notification system (InspectorClient already tracks notifications).

### 8. Session Management

**Challenge**: InspectorClient doesn't track session ID or protocol version.

**Options**:

- **Option A**: Add session tracking to InspectorClient
- **Option B**: Track session in web client via transport access
- **Option C**: Extract from transport after connection

**Recommendation**: Option B - Access transport via `inspectorClient.getClient()` to get session info.

## Integration Strategy

### Phase 1: Extend InspectorClient for Web Client Needs

1. **Add Custom Headers Support**
   - Add `headers?: Record<string, string>` to `SseServerConfig` and `StreamableHttpServerConfig`
   - Pass headers to transport creation

2. **Add Request Handler Access**
   - Document that `getClient()` can be used to set request handlers
   - Or add convenience methods: `setRequestHandler()`, `setElicitationHandler()`, etc.

3. **Add Progress Notification Support**
   - Add `onProgress?: (progress: Progress) => void` to `InspectorClientOptions`
   - Forward progress notifications to callback

### Phase 2: Create Web-Specific Wrapper or Adapter

**Option A: Web-Specific Hook**

- Create `useInspectorClientWeb()` that wraps `useInspectorClient()`
- Handles OAuth, proxy mode, custom headers
- Converts between web client state and InspectorClient

**Option B: Web Connection Adapter**

- Create adapter that converts web client config to `MCPServerConfig`
- Handles proxy URL construction
- Manages OAuth token injection

**Option C: Hybrid Approach**

- Use `InspectorClient` for core MCP operations
- Keep `useConnection` for OAuth, proxy, and web-specific features
- Gradually migrate features to InspectorClient

### Phase 3: Migrate Web Client to InspectorClient

1. **Replace `useConnection` with `useInspectorClient`**
   - Use `useInspectorClient` hook from shared package
   - Handle OAuth and proxy in wrapper/adapter
   - Convert request history format

2. **Update App.tsx**
   - Use InspectorClient state instead of useConnection state
   - Update components to use new state format
   - Migrate request history to MessageEntry format

3. **Remove Duplicate Code**
   - Remove `useConnection` hook
   - Remove duplicate transport creation
   - Remove duplicate server data fetching

## Benefits of Integration

1. **Code Reuse**: Share MCP client logic across TUI, CLI, and web client
2. **Consistency**: Same behavior across all three interfaces
3. **Maintainability**: Single source of truth for MCP operations
4. **Features**: Web client gets message tracking, stderr logging, event-driven updates
5. **Type Safety**: Shared types ensure consistency
6. **Testing**: Shared code is tested once, works everywhere

## Risks and Considerations

1. **Complexity**: Web client has many web-specific features (OAuth, proxy, custom headers)
2. **Breaking Changes**: Migration may require significant refactoring
3. **Testing**: Need to ensure all web client features still work
4. **Performance**: EventTarget events may have different performance characteristics
5. **Bundle Size**: Adding shared package increases bundle size (but code is already there)

## Recommendation

**Start with Option C (Hybrid Approach)**:

1. **Short Term**: Keep `useConnection` for OAuth, proxy, and web-specific features
2. **Medium Term**: Use `InspectorClient` for core MCP operations (tools, resources, prompts)
3. **Long Term**: Gradually migrate to full `InspectorClient` integration

This approach:

- Minimizes risk (incremental migration)
- Allows testing at each step
- Preserves existing functionality
- Enables code sharing where it makes sense
- Provides path to full integration

**Specific Next Steps**:

1. Extend `MCPServerConfig` to support custom headers
2. Create adapter function to convert web client config to `MCPServerConfig`
3. Use `InspectorClient` for tools/resources/prompts operations (via `getClient()` initially)
4. Gradually migrate state management to `useInspectorClient`
5. Eventually replace `useConnection` with `useInspectorClient` + web-specific wrapper
