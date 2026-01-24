# TUI and Web Client Feature Gap Analysis

## Overview

This document details the feature gaps between the TUI (Terminal User Interface) and the web client. The goal is to identify all missing features in the TUI and create a plan to close these gaps by extending `InspectorClient` and implementing the features in the TUI.

## Feature Comparison

**InspectorClient** is the shared client library that provides the core MCP functionality. Both the TUI and web client use `InspectorClient` under the hood. The gaps documented here are primarily **UI-level gaps** - features that `InspectorClient` supports but are not yet exposed in the TUI interface.

| Feature                             | InspectorClient | Web Client UI | TUI | Gap Priority      |
| ----------------------------------- | --------------- | ------------- | --- | ----------------- |
| **Resources**                       |
| List resources                      | ✅              | ✅            | ✅  | -                 |
| Read resource content               | ✅              | ✅            | ✅  | -                 |
| List resource templates             | ✅              | ✅            | ✅  | -                 |
| Read templated resources            | ✅              | ✅            | ✅  | -                 |
| Resource subscriptions              | ✅              | ✅            | ❌  | Medium            |
| Resources listChanged notifications | ✅              | ✅            | ❌  | Medium            |
| Pagination (resources)              | ✅              | ✅            | ✅  | -                 |
| Pagination (resource templates)     | ✅              | ✅            | ✅  | -                 |
| **Prompts**                         |
| List prompts                        | ✅              | ✅            | ✅  | -                 |
| Get prompt (no params)              | ✅              | ✅            | ✅  | -                 |
| Get prompt (with params)            | ✅              | ✅            | ✅  | -                 |
| Prompts listChanged notifications   | ✅              | ✅            | ❌  | Medium            |
| Pagination (prompts)                | ✅              | ✅            | ✅  | -                 |
| **Tools**                           |
| List tools                          | ✅              | ✅            | ✅  | -                 |
| Call tool                           | ✅              | ✅            | ✅  | -                 |
| Tools listChanged notifications     | ✅              | ✅            | ❌  | Medium            |
| Pagination (tools)                  | ✅              | ✅            | ✅  | -                 |
| **Roots**                           |
| List roots                          | ✅              | ✅            | ❌  | Medium            |
| Set roots                           | ✅              | ✅            | ❌  | Medium            |
| Roots listChanged notifications     | ✅              | ✅            | ❌  | Medium            |
| **Authentication**                  |
| OAuth 2.1 flow                      | ❌              | ✅            | ❌  | High              |
| Custom headers                      | ✅ (config)     | ✅ (UI)       | ❌  | Medium            |
| **Advanced Features**               |
| Sampling requests                   | ✅              | ✅            | ❌  | High              |
| Elicitation requests                | ✅              | ✅            | ❌  | High              |
| Completions (resource templates)    | ✅              | ✅            | ❌  | Medium            |
| Completions (prompts with params)   | ✅              | ✅            | ❌  | Medium            |
| Progress tracking                   | ✅              | ✅            | ❌  | Medium            |
| **Other**                           |
| HTTP request tracking               | ✅              | ❌            | ✅  | - (TUI advantage) |

## Detailed Feature Gaps

### 1. Resource Subscriptions

**Web Client Support:**

- Subscribes to resources via `resources/subscribe`
- Unsubscribes via `resources/unsubscribe`
- Tracks subscribed resources in state
- UI shows subscription status and subscribe/unsubscribe buttons
- Handles `notifications/resources/updated` notifications for subscribed resources

**TUI Status:**

- ❌ No support for resource subscriptions
- ❌ No subscription state management
- ❌ No UI for subscribe/unsubscribe actions

**InspectorClient Status:**

- ✅ `subscribeToResource(uri)` method - **COMPLETED**
- ✅ `unsubscribeFromResource(uri)` method - **COMPLETED**
- ✅ Subscription state tracking - **COMPLETED** (`getSubscribedResources()`, `isSubscribedToResource()`)
- ✅ Handler for `notifications/resources/updated` - **COMPLETED**
- ✅ `resourceSubscriptionsChange` event - **COMPLETED**
- ✅ `resourceUpdated` event - **COMPLETED**
- ✅ Cache clearing on resource updates - **COMPLETED** (clears both regular resources and resource templates with matching expandedUri)

**TUI Status:**

- ❌ No UI for resource subscriptions
- ❌ No subscription state management in UI
- ❌ No UI for subscribe/unsubscribe actions
- ❌ No handling of resource update notifications in UI

**Implementation Requirements:**

- ✅ Add `subscribeToResource(uri)` and `unsubscribeFromResource(uri)` methods to `InspectorClient` - **COMPLETED**
- ✅ Add subscription state tracking in `InspectorClient` - **COMPLETED**
- ❌ Add UI in TUI `ResourcesTab` for subscribe/unsubscribe actions
- ✅ Handle resource update notifications for subscribed resources - **COMPLETED** (in InspectorClient)

**Code References:**

- Web client: `client/src/App.tsx` (lines 781-809)
- Web client: `client/src/components/ResourcesTab.tsx` (lines 207-221)

### 2. OAuth 2.1 Authentication

**Web Client Support:**

- Full browser-based OAuth 2.1 flow:
  - Dynamic Client Registration (DCR)
  - Authorization code flow with PKCE
  - Token exchange
  - Token refresh
- OAuth state management via `InspectorOAuthClientProvider`
- Session storage for OAuth tokens
- OAuth callback handling
- Automatic token injection into request headers

**TUI Status:**

- ❌ No OAuth support
- ❌ No OAuth token management

**Implementation Requirements:**

- Browser-based OAuth flow with localhost callback server (TUI-specific approach)
- OAuth token management in `InspectorClient`
- Token injection into transport headers
- OAuth configuration in TUI server config

**Code References:**

- Web client: `client/src/lib/hooks/useConnection.ts` (lines 449-480)
- Web client: `client/src/lib/auth.ts`
- Architecture doc mentions: "There is a plan for implementing OAuth from the TUI"

**Note:** OAuth in TUI requires a browser-based flow with a localhost callback server, which is feasible but different from the web client's approach.

### 3. Sampling Requests

**InspectorClient Support:**

- ✅ Declares `sampling: {}` capability in client initialization (via `sample` option, default: `true`)
- ✅ Sets up request handler for `sampling/createMessage` requests automatically
- ✅ Tracks pending sampling requests via `getPendingSamples()`
- ✅ Provides `SamplingCreateMessage` class with `respond()` and `reject()` methods
- ✅ Dispatches `newPendingSample` and `pendingSamplesChange` events
- ✅ Methods: `getPendingSamples()`, `removePendingSample(id)`

**Web Client Support:**

- UI tab (`SamplingTab`) displays pending sampling requests
- `SamplingRequest` component shows request details and approval UI
- Handles approve/reject actions via `SamplingCreateMessage.respond()`/`reject()`
- Listens to `newPendingSample` events to update UI

**TUI Status:**

- ❌ No UI for sampling requests
- ❌ No sampling request display or handling UI

**Implementation Requirements:**

- Add UI in TUI for displaying pending sampling requests
- Add UI for approve/reject actions (call `respond()` or `reject()` on `SamplingCreateMessage`)
- Listen to `newPendingSample` and `pendingSamplesChange` events
- Add sampling tab or integrate into existing tabs

**Code References:**

- `InspectorClient`: `shared/mcp/inspectorClient.ts` (lines 85-87, 225-226, 401-417, 573-600)
- Web client: `client/src/components/SamplingTab.tsx`
- Web client: `client/src/components/SamplingRequest.tsx`
- Web client: `client/src/App.tsx` (lines 328-333, 637-652)

### 4. Elicitation Requests

**InspectorClient Support:**

- ✅ Declares `elicitation: {}` capability in client initialization (via `elicit` option, default: `true`)
- ✅ Sets up request handler for `elicitation/create` requests automatically
- ✅ Tracks pending elicitation requests via `getPendingElicitations()`
- ✅ Provides `ElicitationCreateMessage` class with `respond()` and `remove()` methods
- ✅ Dispatches `newPendingElicitation` and `pendingElicitationsChange` events
- ✅ Methods: `getPendingElicitations()`, `removePendingElicitation(id)`

**Web Client Support:**

- UI tab (`ElicitationTab`) displays pending elicitation requests
- `ElicitationRequest` component:
  - Shows request message and schema
  - Generates dynamic form from JSON schema
  - Validates form data against schema
  - Handles accept/decline/cancel actions via `ElicitationCreateMessage.respond()`
- Listens to `newPendingElicitation` events to update UI

**TUI Status:**

- ❌ No UI for elicitation requests
- ❌ No elicitation request display or handling UI

**Implementation Requirements:**

- Add UI in TUI for displaying pending elicitation requests
- Add form generation from JSON schema (similar to tool parameter forms)
- Add UI for accept/decline/cancel actions (call `respond()` on `ElicitationCreateMessage`)
- Listen to `newPendingElicitation` and `pendingElicitationsChange` events
- Add elicitation tab or integrate into existing tabs

**Code References:**

- `InspectorClient`: `shared/mcp/inspectorClient.ts` (lines 90-92, 227-228, 420-433, 606-639)
- Web client: `client/src/components/ElicitationTab.tsx`
- Web client: `client/src/components/ElicitationRequest.tsx`
- Web client: `client/src/App.tsx` (lines 334-356, 653-669)
- Web client: `client/src/utils/schemaUtils.ts` (schema resolution for elicitation)

### 5. Completions

**InspectorClient Support:**

- ✅ `getCompletions()` method sends `completion/complete` requests
- ✅ Supports resource template completions: `{ type: "ref/resource", uri: string }`
- ✅ Supports prompt argument completions: `{ type: "ref/prompt", name: string }`
- ✅ Handles `MethodNotFound` errors gracefully (returns empty array if server doesn't support completions)
- ✅ Completion requests include:
  - `ref`: Resource template URI or prompt name
  - `argument`: Field name and current (partial) value
  - `context`: Optional context with other argument values
- ✅ Returns `{ values: string[] }` with completion suggestions

**Web Client Support:**

- Detects completion capability via `serverCapabilities.completions`
- `handleCompletion()` function calls `InspectorClient.getCompletions()`
- Used in resource template forms for autocomplete
- Used in prompt forms with parameters for autocomplete
- `useCompletionState` hook manages completion state and debouncing

**TUI Status:**

- ✅ Prompt fetching with parameters - **COMPLETED** (modal form for collecting prompt arguments)
- ❌ No completion support for resource template forms
- ❌ No completion support for prompt parameter forms
- ❌ No completion capability detection in UI
- ❌ No completion request handling in UI

**Implementation Requirements:**

- Add completion capability detection in TUI (via `InspectorClient.getCapabilities()?.completions`)
- Integrate `InspectorClient.getCompletions()` into TUI forms:
  - **Resource template forms** (`ResourceTestModal`) - autocomplete for template variable values
  - **Prompt parameter forms** (`PromptTestModal`) - autocomplete for prompt argument values
- Add completion state management (debouncing, loading states)
- Trigger completions on input change with debouncing

**Code References:**

- `InspectorClient`: `shared/mcp/inspectorClient.ts` (lines 902-966) - `getCompletions()` method
- Web client: `client/src/lib/hooks/useConnection.ts` (lines 309, 384-386)
- Web client: `client/src/lib/hooks/useCompletionState.ts`
- Web client: `client/src/components/ResourcesTab.tsx` (lines 88-101)
- TUI: `tui/src/components/PromptTestModal.tsx` - Prompt form (needs completion integration)
- TUI: `tui/src/components/ResourceTestModal.tsx` - Resource template form (needs completion integration)

### 6. Progress Tracking

**Use Case:**

Long-running operations (tool calls, resource reads, prompt invocations, etc.) can send progress notifications (`notifications/progress`) to keep clients informed of execution status. This is useful for:

- Showing progress bars or status updates
- Resetting request timeouts on progress notifications
- Providing user feedback during long operations

**Web Client Support:**

- **Progress Token**: Generates and includes `progressToken` in request metadata:
  ```typescript
  const mergedMetadata = {
    ...metadata,
    progressToken: progressTokenRef.current++,
    ...toolMetadata,
  };
  ```
- **Progress Callback**: Sets up `onprogress` callback in `useConnection`:
  ```typescript
  if (mcpRequestOptions.resetTimeoutOnProgress) {
    mcpRequestOptions.onprogress = (params: Progress) => {
      if (onNotification) {
        onNotification({
          method: "notifications/progress",
          params,
        });
      }
    };
  }
  ```
- **Progress Display**: Progress notifications are displayed in the "Server Notifications" window
- **Timeout Reset**: `resetTimeoutOnProgress` option resets request timeout when progress notifications are received

**InspectorClient Status:**

- ✅ Progress notification handling - Registers handler for `notifications/progress` and dispatches `progressNotification` events
- ✅ Progress token support - Accepts `progressToken` in metadata via `callTool` (and other methods)
- ✅ Event-based approach - Uses `progressNotification` events instead of `onprogress` callbacks (clients can listen for events)
- ✅ Token management - Clients can generate and manage their own `progressToken` values as needed
- ❌ No timeout reset on progress - `resetTimeoutOnProgress` option not yet implemented

**TUI Status:**

- ❌ No progress tracking support
- ❌ No progress notification display
- ❌ No progress token management

**Implementation Requirements:**

- ✅ **Completed in InspectorClient:**
  - Progress notification handler registration (when `progress: true` option is set)
  - `progressNotification` event dispatching with full progress params (includes `progressToken`, `progress`, `total`, `message`)
  - Support for `progressToken` in request metadata (via `callTool`, `getPrompt`, etc.)
  - Event-based API - Clients listen for `progressNotification` events instead of using callbacks
- ❌ **Still Needed:**
  - Timeout reset on progress - `resetTimeoutOnProgress` option not yet implemented
- ❌ **TUI UI Support Needed:**
  - Show progress notifications during long-running operations
  - Display progress status in results view
  - Optional: Progress bars or percentage indicators

**Code References:**

- InspectorClient: `shared/mcp/inspectorClient.ts` (lines 598-606) - Progress notification handler registration and event dispatching
- InspectorClient: `shared/mcp/inspectorClient.ts` (lines 1018-1021) - Progress token support via metadata in `callTool`
- Web client: `client/src/App.tsx` (lines 840-892) - Progress token generation and tool call
- Web client: `client/src/lib/hooks/useConnection.ts` (lines 214-226) - Progress callback setup
- SDK types: `RequestOptions` includes `onprogress?: (params: Progress) => void` and `resetTimeoutOnProgress?: boolean`
- SDK types: `Progress` notification type for progress updates

### 7. ListChanged Notifications

**Use Case:**

MCP servers can send `listChanged` notifications when the list of tools, resources, or prompts changes. This allows clients to automatically refresh their UI when the server's capabilities change, without requiring manual refresh actions.

**Web Client Support:**

- **Capability Declaration**: Declares `roots: { listChanged: true }` in client capabilities
- **Notification Handlers**: Sets up handlers for:
  - `notifications/tools/list_changed`
  - `notifications/resources/list_changed`
  - `notifications/prompts/list_changed`
- **Auto-refresh**: When a `listChanged` notification is received, the web client automatically calls the corresponding `list*()` method to refresh the UI
- **Notification Processing**: All notifications are passed to `onNotification` callback, which stores them in state for display

**InspectorClient Status:**

- ✅ Notification handlers for `notifications/tools/list_changed` - **COMPLETED**
- ✅ Notification handlers for `notifications/resources/list_changed` - **COMPLETED** (reloads both resources and resource templates)
- ✅ Notification handlers for `notifications/prompts/list_changed` - **COMPLETED**
- ✅ Automatic list refresh on `listChanged` notifications - **COMPLETED**
- ✅ Configurable via `listChangedNotifications` option - **COMPLETED** (tools, resources, prompts)
- ✅ Cache preservation for existing items - **COMPLETED**
- ✅ Cache cleanup for removed items - **COMPLETED**
- ✅ Event dispatching (`toolsChange`, `resourcesChange`, `resourceTemplatesChange`, `promptsChange`) - **COMPLETED**

**TUI Status:**

- ✅ `listChanged` notifications automatically handled by `InspectorClient` - **COMPLETED**
- ✅ Lists automatically reload when notifications are received - **COMPLETED**
- ✅ Events dispatched (`toolsChange`, `resourcesChange`, `promptsChange`) - **COMPLETED**
- ✅ TUI automatically reflects changes when events are received - **COMPLETED** (if TUI listens to these events)
- ❌ No UI indication when lists are auto-refreshed (optional, but useful for debugging)

**Note on TUI Support:**

The TUI automatically supports `listChanged` notifications through `InspectorClient`. The implementation works as follows:

1. **Server Capability**: The MCP server must advertise `listChanged` capability in its server capabilities (e.g., `tools: { listChanged: true }`, `resources: { listChanged: true }`, `prompts: { listChanged: true }`)

2. **Automatic Handler Registration**: When `InspectorClient` connects, it checks if the server advertises `listChanged` capability. If it does, `InspectorClient` automatically registers notification handlers for:
   - `notifications/tools/list_changed`
   - `notifications/resources/list_changed`
   - `notifications/prompts/list_changed`

3. **Automatic List Reload**: When a `listChanged` notification is received, `InspectorClient` automatically calls the corresponding `listAll*()` method to reload the list

4. **Event Dispatching**: `InspectorClient` dispatches events (`toolsChange`, `resourcesChange`, `resourceTemplatesChange`, `promptsChange`) that the TUI can listen to

5. **TUI Auto-Refresh**: The TUI will automatically reflect changes if it listens to these events (which it should, as it uses `InspectorClient`)

**Important**: The client does NOT need to advertise `listChanged` capability - it only needs to check if the server supports it. The handlers are registered automatically based on server capabilities.

**Implementation Requirements:**

- ✅ Add notification handlers in `InspectorClient.connect()` for `listChanged` notifications - **COMPLETED**
- ✅ When a `listChanged` notification is received, automatically call the corresponding `list*()` method - **COMPLETED**
- ✅ Dispatch events to notify UI of list changes - **COMPLETED**
- ✅ TUI inherits support automatically through `InspectorClient` - **COMPLETED**
- ❌ Add UI in TUI to handle and display these notifications (optional, but useful for debugging)

**Code References:**

- Web client: `client/src/lib/hooks/useConnection.ts` (lines 422-424, 699-704) - Capability declaration and notification handlers
- `InspectorClient`: `shared/mcp/inspectorClient.ts` (line 1004) - TODO comment about listChanged support

### 8. Roots Support

**Use Case:**

Roots are file system paths (as `file://` URIs) that define which directories an MCP server can access. This is a security feature that allows servers to operate within a sandboxed set of directories. Clients can:

- List the current roots configured on the server
- Set/update the roots (if the server supports it)
- Receive notifications when roots change

**Web Client Support:**

- **Capability Declaration**: Declares `roots: { listChanged: true }` in client capabilities
- **UI Component**: `RootsTab` component allows users to:
  - View current roots
  - Add new roots (with URI and optional name)
  - Remove roots
  - Save changes (calls `listRoots` with updated roots)
- **Roots Management**:
  - `getRoots` callback passed to `useConnection` hook
  - Roots are stored in component state
  - When roots are changed, `handleRootsChange` is called to send updated roots to server
- **Notification Support**: Handles `notifications/roots/list_changed` notifications (via fallback handler)

**InspectorClient Support:**

- ✅ `getRoots()` method - Returns current roots
- ✅ `setRoots(roots)` method - Updates roots and sends notification to server if supported
- ✅ Handler for `roots/list` requests from server (returns current roots)
- ✅ Notification handler for `notifications/roots/list_changed` from server
- ✅ `roots: { listChanged: true }` capability declaration (when `roots` option is provided)
- ✅ `rootsChange` event dispatched when roots are updated
- ✅ Roots configured via `roots` option in `InspectorClientOptions` (even empty array enables capability)

**TUI Status:**

- ❌ No roots management UI
- ❌ No roots configuration support

**Implementation Requirements:**

- ✅ `getRoots()` and `setRoots()` methods - **COMPLETED** in `InspectorClient`
- ✅ Handler for `roots/list` requests - **COMPLETED** in `InspectorClient`
- ✅ Notification handler for `notifications/roots/list_changed` - **COMPLETED** in `InspectorClient`
- ✅ `roots: { listChanged: true }` capability declaration - **COMPLETED** in `InspectorClient`
- ❌ Add UI in TUI for managing roots (similar to web client's `RootsTab`)

**Code References:**

- `InspectorClient`: `shared/mcp/inspectorClient.ts` - `getRoots()`, `setRoots()`, roots/list handler, and notification support
- Web client: `client/src/components/RootsTab.tsx` - Roots management UI
- Web client: `client/src/lib/hooks/useConnection.ts` (lines 422-424, 357) - Capability declaration and `getRoots` callback
- Web client: `client/src/App.tsx` (lines 1225-1229) - RootsTab usage

### 9. Custom Headers

**Use Case:**

Custom headers are used to send additional HTTP headers when connecting to MCP servers over HTTP-based transports (SSE or streamable-http). Common use cases include:

- **Authentication**: API keys, bearer tokens, or custom authentication schemes
  - Example: `Authorization: Bearer <token>`
  - Example: `X-API-Key: <api-key>`
- **Multi-tenancy**: Tenant or organization identifiers
  - Example: `X-Tenant-ID: acme-inc`
- **Environment identification**: Staging vs production
  - Example: `X-Environment: staging`
- **Custom server requirements**: Any headers required by the MCP server

**InspectorClient Support:**

- ✅ `MCPServerConfig` supports `headers: Record<string, string>` for SSE and streamable-http transports
- ✅ Headers are passed to the SDK transport during creation
- ✅ Headers are included in all HTTP requests to the MCP server
- ✅ Works with both SSE and streamable-http transports
- ❌ Not supported for stdio transport (stdio doesn't use HTTP)

**Web Client Support:**

- **UI Component**: `CustomHeaders` component in the Sidebar's authentication section
- **Features**:
  - Add/remove headers with name/value pairs
  - Enable/disable individual headers (toggle switch)
  - Mask header values by default (password field with show/hide toggle)
  - Form mode: Individual header inputs
  - JSON mode: Edit all headers as a JSON object
  - Validation: Only enabled headers with both name and value are sent
- **Integration**:
  - Headers are stored in component state
  - Passed to `useConnection` hook
  - Converted to `Record<string, string>` format for transport
  - OAuth tokens can be automatically injected into `Authorization` header if no custom `Authorization` header exists
  - Custom header names are tracked and sent to the proxy server via `x-custom-auth-headers` header

**TUI Status:**

- ❌ No header configuration UI
- ❌ No way for users to specify custom headers in TUI server config
- ✅ `InspectorClient` supports headers if provided in config (but TUI doesn't expose this)

**Implementation Requirements:**

- Add header configuration UI in TUI server configuration
- Allow users to add/edit/remove headers similar to web client
- Store headers in TUI server config
- Pass headers to `InspectorClient` via `MCPServerConfig.headers`
- Consider masking sensitive header values in the UI

**Code References:**

- Web client: `client/src/components/CustomHeaders.tsx` - Header management UI component
- Web client: `client/src/lib/hooks/useConnection.ts` (lines 453-514) - Header processing and transport creation
- `InspectorClient`: `shared/mcp/config.ts` (lines 118-129) - Headers in `MCPServerConfig`
- `InspectorClient`: `shared/mcp/transport.ts` (lines 100-134) - Headers passed to SDK transports

## Implementation Priority

### High Priority (Core MCP Features)

1. **OAuth** - Required for many MCP servers, critical for production use
2. **Sampling** - Core MCP capability, enables LLM sampling workflows
3. **Elicitation** - Core MCP capability, enables interactive workflows

### Medium Priority (Enhanced Features)

4. **Resource Subscriptions** - Useful for real-time resource updates
5. **Completions** - Enhances UX for form filling
6. **Custom Headers** - Useful for custom authentication schemes
7. **ListChanged Notifications** - Auto-refresh lists when server data changes
8. **Roots Support** - Manage file system access for servers
9. **Progress Tracking** - User feedback during long-running operations
10. **Pagination Support** - Handle large lists efficiently (COMPLETED)

## InspectorClient Extensions Needed

Based on this analysis, `InspectorClient` needs the following additions:

1. **Resource Methods** (some already exist):
   - ✅ `readResource(uri, metadata?)` - Already exists
   - ✅ `listResourceTemplates()` - Already exists
   - ✅ Resource template `list` callback support - Already exists (via `listResources()`)
   - ✅ `subscribeToResource(uri)` - **COMPLETED**
   - ✅ `unsubscribeFromResource(uri)` - **COMPLETED**
   - ✅ `getSubscribedResources()` - **COMPLETED**
   - ✅ `isSubscribedToResource(uri)` - **COMPLETED**
   - ✅ `supportsResourceSubscriptions()` - **COMPLETED**
   - ✅ Resource content caching - **COMPLETED** (via `client.cache.getResource()`)
   - ✅ Resource template content caching - **COMPLETED** (via `client.cache.getResourceTemplate()`)
   - ✅ Prompt content caching - **COMPLETED** (via `client.cache.getPrompt()`)
   - ✅ Tool call result caching - **COMPLETED** (via `client.cache.getToolCallResult()`)

2. **Sampling Support**:
   - ✅ `getPendingSamples()` - Already exists
   - ✅ `removePendingSample(id)` - Already exists
   - ✅ `SamplingCreateMessage.respond(result)` - Already exists
   - ✅ `SamplingCreateMessage.reject(error)` - Already exists
   - ✅ Automatic request handler setup - Already exists
   - ✅ `sampling: {}` capability declaration - Already exists (via `sample` option)

3. **Elicitation Support**:
   - ✅ `getPendingElicitations()` - Already exists
   - ✅ `removePendingElicitation(id)` - Already exists
   - ✅ `ElicitationCreateMessage.respond(result)` - Already exists
   - ✅ Automatic request handler setup - Already exists
   - ✅ `elicitation: {}` capability declaration - Already exists (via `elicit` option)

4. **Completion Support**:
   - ✅ `getCompletions(ref, argumentName, argumentValue, context?, metadata?)` - Already exists
   - ✅ Supports resource template completions - Already exists
   - ✅ Supports prompt argument completions - Already exists
   - ❌ Integration into TUI `ResourceTestModal` for template variable completion
   - ❌ Integration into TUI `PromptTestModal` for prompt argument completion

5. **OAuth Support**:
   - ❌ OAuth token management
   - ❌ OAuth flow initiation
   - ❌ Token injection into headers

6. **ListChanged Notifications**:
   - ✅ Notification handlers for `notifications/tools/list_changed` - **COMPLETED**
   - ✅ Notification handlers for `notifications/resources/list_changed` - **COMPLETED**
   - ✅ Notification handlers for `notifications/prompts/list_changed` - **COMPLETED**
   - ✅ Auto-refresh lists when notifications received - **COMPLETED**
   - ✅ Configurable via `listChangedNotifications` option - **COMPLETED**
   - ✅ Cache preservation and cleanup - **COMPLETED**

7. **Roots Support**:
   - ✅ `getRoots()` method - Already exists
   - ✅ `setRoots(roots)` method - Already exists
   - ✅ Handler for `roots/list` requests - Already exists
   - ✅ Notification handler for `notifications/roots/list_changed` - Already exists
   - ✅ `roots: { listChanged: true }` capability declaration - Already exists (when `roots` option provided)
   - ❌ Integration into TUI for managing roots

8. **Pagination Support**:
   - ✅ Cursor parameter support in `listResources()` - **COMPLETED**
   - ✅ Cursor parameter support in `listResourceTemplates()` - **COMPLETED**
   - ✅ Cursor parameter support in `listPrompts()` - **COMPLETED**
   - ✅ Cursor parameter support in `listTools()` - **COMPLETED**
   - ✅ Return `nextCursor` from list methods - **COMPLETED**
   - ✅ Pagination helper methods (`listAll*()`) - **COMPLETED**

9. **Progress Tracking**:
   - ✅ Progress notification handling - Implemented (dispatches `progressNotification` events)
   - ✅ Progress token support - Implemented (accepts `progressToken` in metadata)
   - ✅ Event-based API - Clients listen for `progressNotification` events (no callbacks needed)
   - ❌ Timeout reset on progress - Not yet implemented (`resetTimeoutOnProgress` option)

## Notes

- **HTTP Request Tracking**: `InspectorClient` tracks HTTP requests for SSE and streamable-http transports via `getFetchRequests()`. TUI displays these requests in a `RequestsTab`. Web client does not currently display HTTP request tracking, though the underlying `InspectorClient` supports it. This is a TUI advantage, not a gap.
- **Resource Subscriptions**: Web client supports this, but TUI does not. `InspectorClient` now fully supports resource subscriptions with `subscribeToResource()`, `unsubscribeFromResource()`, and automatic handling of `notifications/resources/updated` notifications.
- **OAuth**: Web client has full OAuth support. TUI needs browser-based OAuth flow with localhost callback server. `InspectorClient` does not yet support OAuth.
- **Completions**: `InspectorClient` has full completion support via `getCompletions()`. Web client uses this for resource template forms and prompt parameter forms. TUI has both resource template forms and prompt parameter forms, but completion support is still needed to provide autocomplete suggestions.
- **Sampling**: `InspectorClient` has full sampling support. Web client UI displays and handles sampling requests. TUI needs UI to display and handle sampling requests.
- **Elicitation**: `InspectorClient` has full elicitation support. Web client UI displays and handles elicitation requests. TUI needs UI to display and handle elicitation requests.
- **ListChanged Notifications**: Web client handles `listChanged` notifications for tools, resources, and prompts, automatically refreshing lists when notifications are received. `InspectorClient` now fully supports these notifications with automatic list refresh, cache preservation/cleanup, and configurable handlers. TUI automatically benefits from this functionality but doesn't have UI to display notification events.
- **Roots**: `InspectorClient` has full roots support with `getRoots()` and `setRoots()` methods, handler for `roots/list` requests, and notification support. Web client has a `RootsTab` UI for managing roots. TUI does not yet have UI for managing roots.
- **Pagination**: Web client supports cursor-based pagination for all list methods (tools, resources, resource templates, prompts), tracking `nextCursor` state and making multiple requests to fetch all items. `InspectorClient` now fully supports pagination with cursor parameters in all list methods and `listAll*()` helper methods that automatically fetch all pages. TUI inherits this pagination support from `InspectorClient`.
- **Progress Tracking**: Web client supports progress tracking for long-running operations by generating `progressToken` values, setting up `onprogress` callbacks, and displaying progress notifications. `InspectorClient` now supports progress notification handling (dispatches `progressNotification` events) and accepts `progressToken` in metadata. Clients can generate their own tokens and listen for events. The only missing feature is timeout reset on progress (`resetTimeoutOnProgress` option). TUI does not yet have UI support for displaying progress notifications.

## Related Documentation

- [Shared Code Architecture](./shared-code-architecture.md) - Overall architecture and integration plan
- [InspectorClient Details](./inspector-client-details.svg) - Visual diagram of InspectorClient responsibilities
