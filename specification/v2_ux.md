# Inspector V2 UX Specification

### [Brief](README.md) | [V1 Problems](v1_problems.md) | [V2 Scope](v2_scope.md) | [V2 Tech Stack](v2_tech_stack.md) | V2 UX

## Table of Contents
  * [Design Principles](#design-principles)
  * [Navigation Model](#navigation-model)
  * [Screen Flows](#screen-flows)
    * [Server List (Home)](#server-list-home)
    * [Server Connection Card](#server-connection-card)
    * [Server Settings Modal](#server-settings-modal)
    * [Import server.json Modal](#import-serverjson-modal)
    * [Server Info (Connected)](#server-info-connected)
    * [OAuth Debugger](#oauth-debugger)
    * [Feature Screens](#feature-screens)
      * [Tools Screen](#tools-screen)
      * [Resources Screen](#resources-screen)
      * [Prompts Screen](#prompts-screen)
      * [Logging Screen](#logging-screen)
      * [Tasks Screen](#tasks-screen)
      * [History Screen](#history-screen)
    * [Client Feature Handlers](#client-feature-handlers)
      * [Sampling Panel](#sampling-panel)
      * [Elicitation Handler](#elicitation-handler)
      * [Roots Configuration](#roots-configuration)
      * [Experimental Features Panel](#experimental-features-panel)
  * [Form Generation](#form-generation)
  * [Error Handling UX](#error-handling-ux)
  * [MCP Protocol Coverage](#mcp-protocol-coverage)

## Design Principles

- **Single server connection** - No multiple concurrent connections (defer to plugins)
- **MCPJam-inspired** - Use MCPJam Inspector as UX reference model
- **Full-width content** - Maximize screen real estate for each section
- **No sidebar** - Deferred until menu becomes cumbersome or extensions multiply
- **Progressive disclosure** - Show relevant information at each connection stage
- **Resizable panels** - Allow users to adjust panel sizes on feature screens

## Navigation Model

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│  [Server Name ▼]  ● Connected (23ms)  [Tools] [Resources] [Prompts] [Logs] [Tasks] [History] [Disconnect] │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│                                   Full-width content                                    │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Menu bar** displays server name, connection status with latency, and disconnect button when connected
- **Top navigation** links to Tools, Resources, Prompts, Logs, Tasks, and History sections
- **Connection indicator** shows latency from periodic `ping` requests
- **No sidebar** - content areas use full width

## Screen Flows

### Server List (Home)

Initial screen shown when no server is connected. Displays server cards in a responsive grid (1-2 columns).

```
┌─────────────────────────────────────────────────────────┐
│                    MCP Inspector                        │
│                                        [+ Add Server ▼] │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────────┐  ┌─────────────────────────┐
│  │ Server Card 1           │  │ Server Card 2           │
│  │ (see below)             │  │ (see below)             │
│  └─────────────────────────┘  └─────────────────────────┘
│                                                         │
│  ┌─────────────────────────┐                            │
│  │ Server Card 3           │                            │
│  └─────────────────────────┘                            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Add Server Options:**
- **Add manually** - Opens form modal for manual configuration
- **Import config** - Paste/upload internal `mcp.json` config
- **Import server.json** - Import MCP Registry format ([Issue #922](https://github.com/modelcontextprotocol/inspector/issues/922))

**Functionality:**
- List servers from `mcp.json` config file
- Add/edit/delete servers via CRUD endpoints on proxy
- Responsive grid layout (1 column mobile, 2 columns desktop)

### Server Connection Card

Each server in the list is displayed as a card with connection controls and status.

```
┌─────────────────────────────────────────────────────────────────┐
│ [Icon] Server Name                        v1.0.0                │
│        STDIO  [Via Proxy ▼]               [●] Connected [Toggle]│
├─────────────────────────────────────────────────────────────────┤
│ npx -y @modelcontextprotocol/server-everything            [Copy]│
├─────────────────────────────────────────────────────────────────┤
│ [Server Info] [Settings] [Clone]                 [Edit] [Remove]│
└─────────────────────────────────────────────────────────────────┘
```

**Connection Mode Dropdown:**
- Quick access to switch between Direct and Via Proxy modes without opening Settings
- STDIO servers default to "Via Proxy" (required - cannot connect directly from browser)
- HTTP/SSE servers default to "Direct" (assumes CORS enabled)
- Shows warning text if STDIO + Direct selected: "(STDIO requires proxy)"

**With OAuth (shows OAuth Debug button):**
```
┌─────────────────────────────────────────────────────────────────┐
│ [Icon] Server Name                        v1.0.0                │
│        HTTP  [Direct ▼]                   [●] Connected [Toggle]│
├─────────────────────────────────────────────────────────────────┤
│ https://api.example.com/mcp                               [Copy]│
├─────────────────────────────────────────────────────────────────┤
│ [Server Info] [Settings] [OAuth Debug] [Clone]   [Edit] [Remove]│
└─────────────────────────────────────────────────────────────────┘
```

**With Error State:**
```
┌─────────────────────────────────────────────────────────────────┐
│ [Icon] Server Name                        v1.0.0                │
│        HTTP  [Direct ▼]                   [●] Failed (3)[Toggle]│
├─────────────────────────────────────────────────────────────────┤
│ https://api.example.com/mcp                               [Copy]│
├─────────────────────────────────────────────────────────────────┤
│ [Server Info] [Settings] [Clone]                 [Edit] [Remove]│
├─────────────────────────────────────────────────────────────────┤
│ [!] Connection timeout after 20s                                │
│ [Show more]                        [View Troubleshooting Guide] │
└─────────────────────────────────────────────────────────────────┘
```

**Status Indicators:**
| Status | Indicator | Display |
|--------|-----------|---------|
| Connected | Green dot | "Connected" |
| Connecting | Yellow pulsing dot | "Connecting..." |
| Failed | Red dot | "Failed (N)" with retry count |
| Disconnected | Gray dot | "Disconnected" |

**Card Actions:**
- **Toggle switch** - Connect/disconnect the server
- **Copy** - Copy command/URL to clipboard
- **Server Info** - Opens server info modal
- **Settings** - Opens server settings modal (see below)
- **OAuth Debug** - Opens OAuth debugger modal (visible when server uses OAuth)
- **Clone** - Duplicates server config for creating variants
- **Edit** - Opens edit server modal
- **Remove** - Deletes server (with confirmation)

### Server Settings Modal

Per-server configuration for connection behavior, headers, metadata, timeouts, and OAuth credentials.

```
+---------------------------------------------------------------------------+
| Server Settings: my-server                                            [x] |
+---------------------------------------------------------------------------+
|                                                                           |
| Connection Mode                                                           |
| +-----------------------------------------------------------------------+ |
| | Via Proxy                                                           v | |
| +-----------------------------------------------------------------------+ |
|   Direct - Connect directly to server (requires CORS support)             |
|   Via Proxy - Route through inspector proxy (required for STDIO)          |
|                                                                           |
| ---------------------------------------------------------------------------
|                                                                           |
| Custom Headers                                                            |
| +-----------------------------------------------------------------------+ |
| | Authorization      | Bearer sk-...                           [Remove]| |
| | X-Custom-Header    | custom-value                            [Remove]| |
| +-----------------------------------------------------------------------+ |
| [+ Add Header]                                                            |
|                                                                           |
| ---------------------------------------------------------------------------
|                                                                           |
| Request Metadata                                                          |
| Metadata sent with every MCP request to this server.                      |
| +-----------------------------------------------------------------------+ |
| | session_id         | abc123                                  [Remove]| |
| +-----------------------------------------------------------------------+ |
| [+ Add Metadata]                                                          |
|                                                                           |
| ---------------------------------------------------------------------------
|                                                                           |
| Timeouts                                                                  |
| +-----------------------------------+-----------------------------------+ |
| | Connection Timeout                | Request Timeout                   | |
| | +-----------------------------+   | +-----------------------------+   | |
| | | 30000                     ms|   | | 60000                     ms|   | |
| | +-----------------------------+   | +-----------------------------+   | |
| +-----------------------------------+-----------------------------------+ |
|                                                                           |
| ---------------------------------------------------------------------------
|                                                                           |
| OAuth Settings (for servers requiring authentication)                     |
| +-----------------------------------------------------------------------+ |
| | Client ID                                                             | |
| | +-------------------------------------------------------------------+ | |
| | | my-client-id                                                      | | |
| | +-------------------------------------------------------------------+ | |
| |                                                                       | |
| | Client Secret                                                         | |
| | +-------------------------------------------------------------------+ | |
| | | ********                                              [Show/Hide] | | |
| | +-------------------------------------------------------------------+ | |
| |                                                                       | |
| | Scopes                                                                | |
| | +-------------------------------------------------------------------+ | |
| | | read write profile                                                | | |
| | +-------------------------------------------------------------------+ | |
| +-----------------------------------------------------------------------+ |
|                                                                           |
|                                                 [Cancel]  [Save Settings] |
+---------------------------------------------------------------------------+
```

**Connection Mode:**
- **Direct** - Browser connects directly to server (requires server to have CORS headers)
- **Via Proxy** - Route through inspector proxy (required for STDIO transport, useful for CORS-restricted servers)

**Custom Headers:**
- Key-value pairs sent with every HTTP request to this server
- Useful for API keys, authorization tokens, custom routing

**Request Metadata:**
- Data included in `_meta` field of every MCP request
- Per-server isolation (previously stored globally in localStorage)

**Timeouts:**
- **Connection Timeout** - Max time to establish connection (ms)
- **Request Timeout** - Max time for individual requests (ms)

**OAuth Settings:**
- Pre-configure OAuth credentials for servers requiring authentication
- Client ID and Client Secret for OAuth 2.0 flows
- Scopes to request during authorization

**Clone Functionality:**
The [Clone] button on the server card creates a duplicate configuration, enabling:
- Testing same server with different headers/metadata
- Comparing behavior with different timeout settings
- Maintaining separate OAuth credentials for different environments

### Import server.json Modal

Support for importing MCP Registry `server.json` format for testing servers before publishing.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Import MCP Registry server.json                                         [×] │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│ Paste server.json content or drag and drop a file:                          │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ {                                                                       │ │
│ │   "$schema": "https://static.modelcontextprotocol.io/schemas/...",      │ │
│ │   "name": "io.github.user/my-server",                                   │ │
│ │   "description": "A sample MCP server",                                 │ │
│ │   "version": "1.0.0",                                                   │ │
│ │   "packages": [{                                                        │ │
│ │     "registryType": "npm",                                              │ │
│ │     "identifier": "my-mcp-server",                                      │ │
│ │     "runtimeHint": "npx",                                               │ │
│ │     "transport": { "type": "stdio" },                                   │ │
│ │     "environmentVariables": [                                           │ │
│ │       { "name": "API_KEY", "description": "API key", "required": true } │ │
│ │     ]                                                                   │ │
│ │   }]                                                                    │ │
│ │ }                                                                       │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                                                          [Browse...] [Clear]│
│                                                                             │
│ ─────────────────────────────────────────────────────────────────────────── │
│                                                                             │
│ Validation Results:                                                         │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ ✓ Schema validation passed                                              │ │
│ │ ✓ Package found: my-mcp-server (npm)                                    │ │
│ │ ⚠ Environment variable API_KEY not set                                  │ │
│ │ ℹ Runtime hint: npx                                                     │ │
│ │ ℹ Transport: stdio                                                      │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│ ─────────────────────────────────────────────────────────────────────────── │
│                                                                             │
│ Package Selection (if multiple packages):                                   │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ ● npm: my-mcp-server (npx)                                              │ │
│ │ ○ pypi: my-mcp-server (uvx)                                             │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│ Environment Variables:                                                      │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ API_KEY *                   Description: API key                        │ │
│ │ ┌─────────────────────────────────────────────────────────────────────┐ │ │
│ │ │ sk-...                                                              │ │ │
│ │ └─────────────────────────────────────────────────────────────────────┘ │ │
│ │                                                                         │ │
│ │ OPTIONAL_VAR                Description: Optional setting               │ │
│ │ ┌─────────────────────────────────────────────────────────────────────┐ │ │
│ │ │                                                                     │ │ │
│ │ └─────────────────────────────────────────────────────────────────────┘ │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│ Server Name (optional override):                                            │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ my-server                                                               │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│                                    [Validate Again]  [Cancel]  [Add Server] │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Browse Button:**
- Opens native file picker to select a local `server.json` file
- Supports `.json` file filter
- Note: Registry browser may be added as future enhancement or plugin

**Schema Validation:**
- Validate against official MCP Registry schema
- Show validation errors inline with line numbers
- Highlight issues in the JSON editor

**Package Selection:**
- If server.json contains multiple packages (npm + pypi), let user choose which to use
- Display registry type, identifier, and runtime hint for each option

**Environment Variables:**
- Parse `environmentVariables` array from selected package
- Generate form fields for each variable
- Mark required variables with asterisk (*)
- Show description as helper text
- Validate required variables are filled before enabling "Add Server"

**Value Verification:**
- Check if package exists in registry (npm, pypi)
- Verify environment variables are set (or prompt user)
- For HTTP transport: optionally verify URL is reachable
- For STDIO: verify command is available (e.g., `npx` installed)

**Server Generation:**
- Convert server.json to internal config format
- Construct command from runtime hint + package identifier (e.g., `npx -y my-mcp-server`)
- Apply environment variables
- Set transport type from package.transport

**server.json to Internal Config Mapping:**
| server.json Field | Internal Config Field |
|-------------------|----------------------|
| `name` | `name` (display name) |
| `packages[n].registryType` | Determines command prefix |
| `packages[n].identifier` | Package name in command |
| `packages[n].runtimeHint` | Command prefix (npx, uvx, etc.) |
| `packages[n].transport.type` | `transportType` |
| `packages[n].environmentVariables` | `env` object |

**Use Cases:**
1. MCP authors testing server.json before publishing to registry
2. Developers importing servers from registry without manual setup
3. Configuration troubleshooting with detailed validation feedback

### Server Info (Connected)

Shown as a modal or dedicated screen after successful connection.

```
┌─────────────────────────────────────────────────────────┐
│  Server Information                              [×]    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Name:        everything-server                         │
│  Version:     1.0.0                                     │
│  Protocol:    2025-11-25                                │
│  Transport:   stdio                                     │
│                                                         │
│  Server Capabilities          Client Capabilities       │
│  ─────────────────────        ─────────────────────     │
│  ✓ Tools (4)                  ✓ Sampling                │
│  ✓ Resources (12)             ✓ Elicitation             │
│  ✓ Prompts (2)                ✓ Roots (3)               │
│  ✓ Logging                    ✓ Tasks                   │
│  ✓ Completions                                          │
│  ✓ Tasks                                                │
│  ✗ Experimental                                         │
│                                                         │
│  Server Instructions                                    │
│  ───────────────────                                    │
│  "This server provides testing tools for MCP..."        │
│                                                         │
│  OAuth Details (if applicable)                          │
│  ─────────────                                          │
│  Auth URL:    https://auth.example.com                  │
│  Scopes:      read, write                               │
│  Access Token: eyJhbG... [Copy] [Decode JWT ▼]          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Functionality:**
- Display server metadata, version, and negotiated protocol version
- Show both **server** and **client** capabilities with counts
- Server capabilities: Tools, Resources, Prompts, Logging, Completions, Tasks, Experimental
- Client capabilities: Sampling, Elicitation, Roots, Tasks, Experimental
- Display server instructions if provided
- Show OAuth tokens with copy and JWT decode options

### OAuth Debugger

Accessed via [OAuth Debug] button on the server card (visible when server uses OAuth).

```
+---------------------------------------------------------------------------+
| OAuth Debugger: my-server                                             [x] |
+---------------------------------------------------------------------------+
|                                                                           |
| OAuth Flow Status                                                         |
| +-----------------------------------------------------------------------+ |
| | Step 1: Authorization Request                             [Completed] | |
| | +-------------------------------------------------------------------+ | |
| | | GET https://auth.example.com/authorize                            | | |
| | |   ?client_id=my-client-id                                         | | |
| | |   &redirect_uri=http://localhost:5173/callback                    | | |
| | |   &response_type=code                                             | | |
| | |   &scope=read%20write                                             | | |
| | |   &state=abc123                                                   | | |
| | +-------------------------------------------------------------------+ | |
| |                                                             [Copy URL] | |
| +-----------------------------------------------------------------------+ |
|                                                                           |
| +-----------------------------------------------------------------------+ |
| | Step 2: Authorization Code                                [Completed] | |
| | +-------------------------------------------------------------------+ | |
| | | code: xyz789...                                                   | | |
| | | state: abc123 (verified)                                          | | |
| | +-------------------------------------------------------------------+ | |
| +-----------------------------------------------------------------------+ |
|                                                                           |
| +-----------------------------------------------------------------------+ |
| | Step 3: Token Exchange                                    [Completed] | |
| | +-------------------------------------------------------------------+ | |
| | | POST https://auth.example.com/token                               | | |
| | | grant_type=authorization_code&code=xyz789...                      | | |
| | +-------------------------------------------------------------------+ | |
| +-----------------------------------------------------------------------+ |
|                                                                           |
| +-----------------------------------------------------------------------+ |
| | Step 4: Access Token                                      [Active]    | |
| | +-------------------------------------------------------------------+ | |
| | | access_token: eyJhbG...                           [Copy] [Decode] | | |
| | | token_type: Bearer                                                | | |
| | | expires_in: 3600 (expires at 15:32:00)                            | | |
| | | scope: read write                                                 | | |
| | +-------------------------------------------------------------------+ | |
| +-----------------------------------------------------------------------+ |
|                                                                           |
| +-----------------------------------------------------------------------+ |
| | Refresh Token                                                         | |
| | +-------------------------------------------------------------------+ | |
| | | refresh_token: def456...                                  [Copy]  | | |
| | +-------------------------------------------------------------------+ | |
| |                                                    [Test Refresh Now] | |
| +-----------------------------------------------------------------------+ |
|                                                                           |
| ---------------------------------------------------------------------------
|                                                                           |
| Decoded Access Token (JWT)                                                |
| +-----------------------------------------------------------------------+ |
| | Header:                                                               | |
| |   { "alg": "RS256", "typ": "JWT" }                                   | |
| |                                                                       | |
| | Payload:                                                              | |
| |   {                                                                   | |
| |     "sub": "user123",                                                 | |
| |     "aud": "my-client-id",                                            | |
| |     "scope": "read write",                                            | |
| |     "exp": 1732990800,                                                | |
| |     "iat": 1732987200                                                 | |
| |   }                                                                   | |
| +-----------------------------------------------------------------------+ |
|                                                                           |
|                                          [Revoke Token]  [Start New Flow] |
+---------------------------------------------------------------------------+
```

**Features:**
- **Flow Visualization** - Step-by-step view of OAuth 2.0 flow
  - Authorization request URL with all parameters
  - Authorization code received
  - Token exchange request/response
  - Access token details
- **Token Display:**
  - Access token with copy and decode options
  - Token type and expiration time
  - Refresh token (if available)
  - Decoded JWT payload and header
- **Actions:**
  - [Test Refresh Now] - Manually trigger token refresh
  - [Revoke Token] - Revoke current access token
  - [Start New Flow] - Begin fresh OAuth flow
  - [Copy] - Copy tokens/URLs to clipboard
  - [Decode] - Show JWT contents

**Use Cases:**
1. Debugging OAuth configuration issues
2. Verifying token claims and scopes
3. Testing token refresh behavior
4. Understanding the full OAuth handshake

### Feature Screens

Each feature screen uses a **resizable panel layout** for flexibility.

#### Tools Screen

```
┌─────────────────┬──────────────────────────────────────┬────────────────────────┐
│ Tools (4)       │ Parameters                           │ Results                │
│ ● List updated  │ (40%)                                │ (30%)                  │
│ [Refresh Now]   │ ↔ resize                             │                        │
├─────────────────┼──────────────────────────────────────┼────────────────────────┤
│                 │                                      │                        │
│ [Search...]     │ Tool: query_database                 │ Output:                │
│                 │ ───────────────────                  │                        │
│ ● query_db      │ Annotations:                         │ ┌──────────────────┐   │
│   [user]       │   Audience: user                      │ │                  │   │
│   [read-only]  │   Read-only: true                     │ │   [Image]        │   │
│                 │   Hints: "Useful for data queries"   │ │                  │   │
│ ○ echo          │                                      │ └──────────────────┘   │
│ ○ add           │ table *                              │                        │
│ ○ longOp        │ ┌────────────────────────────────┐   │ {                      │
│   [long-run]   │ │ users                        ▼ │   │   "rows": 42,          │
│ ○ dangerOp      │ └────────────────────────────────┘   │   "data": [...]        │
│   [destructive]│   Suggestions: users, orders, items │ }                      │
│                 │                                      │                        │
│                 │ limit                                │ [Play Audio]           │
│                 │ ┌────────────────────────────────┐   │                        │
│                 │ │ 100                            │   │ [Copy] [Clear]         │
│                 │ └────────────────────────────────┘   │                        │
│                 │                                      │                        │
│                 │ ████████████░░░░░░░░ 60%             │                        │
│                 │ Processing step 3 of 5...            │                        │
│                 │                                      │                        │
│                 │ [Execute Tool]           [Cancel]    │                        │
└─────────────────┴──────────────────────────────────────┴────────────────────────┘
```

**Features:**
- **List Changed Indicator** - Shows when `notifications/tools/list_changed` received, with refresh button
- Searchable/filterable tool list
- **Tool Annotations** displayed:
  - Audience badge ([user], [assistant])
  - Read-only indicator ([read-only])
  - Destructive warning ([destructive])
  - Long-running indicator ([long-run])
  - Custom hints from server
- **Autocomplete** for arguments via `completion/complete`:
  - Dropdown suggestions as user types
  - Supports enum and dynamic completion
- Form generated from tool input schema
- **Per-Tool Metadata** - [Edit Metadata] button to set tool-specific `_meta` fields:
  - Stored per-server, per-tool (not in global localStorage)
  - Merged with server-level metadata on each call
  - Use case: Different progressToken behavior, tool-specific tracking IDs
- **Progress Indicator** from `notifications/progress`:
  - Progress bar with percentage
  - Step description if provided
  - Elapsed time display
- Execute button with loading state
- **Cancel button** sends `notifications/cancelled`
- **Rich Result Display**:
  - JSON/text with syntax highlighting
  - Image preview for image content (base64)
  - Audio player for audio content (base64)
  - Resource links displayed as clickable references

#### Resources Screen

Uses an **accordion layout** for the left panel to organize Resources, Templates, and Subscriptions into collapsible sections.

```
┌────────────────────────────────┬────────────────────────────────────────────┐
│ Resources                      │ Content Preview (65%)                      │
│ ● List updated [Refresh Now]   │                                            │
├────────────────────────────────┼────────────────────────────────────────────┤
│                                │                                            │
│ [Search...]                    │ URI: file:///config.json                   │
│                                │ MIME: application/json                     │
│ [v] Resources (12)             │ ─────────────────────────────              │
│ ├─────────────────────────────┐│                                            │
│ │ ● config.json               ││ Annotations:                               │
│ │   [application]             ││   Audience: application                    │
│ │   [priority: 0.9]           ││   Priority: 0.9 (high)                     │
│ │                             ││                                            │
│ │ ○ readme.md                 ││ {                                          │
│ │   [user]                    ││   "name": "my-app",                        │
│ │                             ││   "version": "1.0.0"                       │
│ │ ○ data.csv                  ││ }                                          │
│ │ ○ schema.json               ││                                            │
│ │   ... (8 more)              ││ [Copy] [Subscribe] [Unsubscribe]           │
│ └─────────────────────────────┘│                                            │
│                                │ Last updated: 14:32:05                     │
│ [>] Templates (2)              │                                            │
│                                │                                            │
│ [>] Subscriptions (1)          │                                            │
│                                │                                            │
└────────────────────────────────┴────────────────────────────────────────────┘
```

**Expanded Templates Section:**
```
│ [v] Templates (2)              │
│ ├─────────────────────────────┐│
│ │ ○ user/{id}                 ││
│ │   [id: ________ ] [Go]      ││
│ │                             ││
│ │ ○ file/{path}               ││
│ │   [path: _______ ] [Go]     ││
│ └─────────────────────────────┘│
```

**Expanded Subscriptions Section:**
```
│ [v] Subscriptions (1)          │
│ ├─────────────────────────────┐│
│ │ ● config.json               ││
│ │   Last update: 14:32:05     ││
│ │                  [Unsub]    ││
│ └─────────────────────────────┘│
```

**Accordion Behavior:**
- Sections expand/collapse independently by clicking header
- [v] indicates expanded section, [>] indicates collapsed
- Empty sections show "(0)" count and collapse by default
- If only Resources exist, that section expands by default
- Search filters across all sections simultaneously

**Features:**
- **List Changed Indicator** - Shows when `notifications/resources/list_changed` received
- **Accordion Layout** - Collapsible sections for Resources, Templates, Subscriptions
- List resources with pagination within each section
- **Resource Annotations** displayed:
  - Audience badge ([user], [application/assistant])
  - Priority indicator ([high], [medium], [low])
- Resource templates with inline variable input and [Go] button
- Subscribe/unsubscribe to resource updates
- **Subscriptions Section** shows active subscriptions with last update time
- Content viewer (JSON, text, binary preview)
- Image preview for image resources
- Audio player for audio resources

#### Prompts Screen

```
┌──────────────────────────────┬──────────────────────────────────────────┐
│ Prompts (2)                  │ Result (65%)                             │
│ ● List updated [Refresh Now] │                                          │
├──────────────────────────────┼──────────────────────────────────────────┤
│                              │                                          │
│ Select Prompt:               │ Messages:                                │
│ ┌──────────────────────────┐ │                                          │
│ │ greeting_prompt        ▼ │ │ [0] role: user                           │
│ └──────────────────────────┘ │     Content:                             │
│                              │     "Hello, my name is John and I        │
│ Description:                 │      like cats"                          │
│ "Generates a friendly        │                                          │
│  greeting message"           │     [Image: profile.png]                 │
│                              │                                          │
│ Arguments:                   │ [1] role: assistant                      │
│ ─────────────                │     "Nice to meet you, John! I see       │
│                              │      you're a cat lover..."              │
│ name *                       │                                          │
│ ┌──────────────────────────┐ │                                          │
│ │ John                   ▼ │ │                                          │
│ └──────────────────────────┘ │                                          │
│   Suggestions: John, Jane    │                                          │
│                              │                                          │
│ interests                    │                                          │
│ ┌──────────────────────────┐ │                                          │
│ │ cats                     │ │                                          │
│ └──────────────────────────┘ │                                          │
│                              │                                          │
│ [Get Prompt]                 │ [Copy JSON] [Copy Messages]              │
└──────────────────────────────┴──────────────────────────────────────────┘
```

**Features:**
- **List Changed Indicator** - Shows when `notifications/prompts/list_changed` received
- Dropdown to select from available prompts
- Prompt description displayed
- **Autocomplete** for arguments via `completion/complete`
- Form generated from prompt arguments
- Display prompt messages result with:
  - Role labels
  - Text content
  - Image content preview
  - Audio content player
  - Embedded resource display
- Copy functionality (JSON or plain messages)

#### Logging Screen

```
┌───────────────────────┬─────────────────────────────────────────────────────┐
│ Log Controls (25%)    │ Log Stream (75%)                                    │
│ ↔ resize              │                                                     │
├───────────────────────┼─────────────────────────────────────────────────────┤
│                       │                                                     │
│ Log Level:            │ 14:32:01 [INFO]     Server initialized              │
│ ┌─────────────────┐   │ 14:32:02 [DEBUG]    Loading tool: echo              │
│ │ debug         ▼ │   │ 14:32:02 [DEBUG]    Loading tool: add               │
│ └─────────────────┘   │ 14:32:03 [NOTICE]   Configuration loaded            │
│                       │ 14:32:05 [WARNING]  Rate limit approaching          │
│ [Set Level]           │ 14:32:10 [ERROR]    Failed to fetch resource: 404   │
│                       │ 14:32:15 [CRITICAL] Database connection lost        │
│ Filter:               │ 14:32:16 [ALERT]    Service degraded                │
│ ┌─────────────────┐   │ 14:32:20 [EMERGENCY] System failure                 │
│ │                 │   │                                                     │
│ └─────────────────┘   │ ─────────────────────────────────────────────────   │
│                       │                                                     │
│ Show Levels:          │                                                     │
│ ☑ DEBUG               │                                                     │
│ ☑ INFO                │                                                     │
│ ☑ NOTICE              │                                                     │
│ ☑ WARNING             │                                                     │
│ ☑ ERROR               │                                                     │
│ ☑ CRITICAL            │                                                     │
│ ☑ ALERT               │                                                     │
│ ☑ EMERGENCY           │                                                     │
│                       │                                                     │
│ [Clear] [Export]      │ [Auto-scroll ✓] [Copy All]                          │
└───────────────────────┴─────────────────────────────────────────────────────┘
```

**Features:**
- **Set Log Level** via `logging/setLevel` request
  - Options: debug, info, notice, warning, error, critical, alert, emergency
- **Real-time Log Stream** from `notifications/message`
- Filter by text search
- Filter by log level checkboxes (all 8 RFC 5424 levels)
- **Color-coded by severity** (8 distinct visual treatments):

| Level | Color | Style |
|-------|-------|-------|
| DEBUG | Gray | Normal |
| INFO | Blue | Normal |
| NOTICE | Cyan | Normal |
| WARNING | Yellow | Normal |
| ERROR | Red | Normal |
| CRITICAL | Red | Bold |
| ALERT | Magenta | Bold |
| EMERGENCY | White on Red | Background highlight |

- Timestamp display
- Logger name display (if provided)
- Auto-scroll toggle
- Export logs to file
- Copy all logs to clipboard

#### Tasks Screen

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Tasks                                                     [Refresh]     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ Active Tasks (2)                                                        │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ Task: abc-123              Status: running         ████████░░ 80%  │ │
│ │ Method: tools/call                                                  │ │
│ │ Tool: longRunningOperation                                          │ │
│ │ Started: 14:32:05          Elapsed: 45s                             │ │
│ │ Progress: Processing batch 4 of 5...                                │ │
│ │                                            [View Details] [Cancel]  │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ Task: def-456              Status: waiting         ░░░░░░░░░░ 0%   │ │
│ │ Method: resources/read                                              │ │
│ │ Resource: large-dataset                                             │ │
│ │ Started: 14:33:00          Elapsed: 10s                             │ │
│ │                                            [View Details] [Cancel]  │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ Completed Tasks (3)                                    [Clear History]  │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ Task: ghi-789              Status: completed       ██████████ 100% │ │
│ │ Method: tools/call (processData)                                    │ │
│ │ Completed: 14:31:30        Duration: 1m 30s                         │ │
│ │                                            [View Result] [Dismiss]  │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Features:**
- **Task List** via `tasks/list` request
- **Real-time Status Updates** via `notifications/task/statusChanged`
- **Progress Display** from `notifications/progress`:
  - Progress bar with percentage
  - Current step description
  - Total/current progress numbers
- Task states: waiting, running, completed, failed, cancelled
- **Cancel Tasks** via `tasks/cancel`
- **View Results** via `tasks/result`
- **View Task Details** via `tasks/get`
- Task history with dismissal
- Elapsed time / duration display

#### History Screen

A unified history of all MCP requests with replay capability.

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ History                                           [Search...] [Filter ▼] [Clear All] │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                     │
│ ┌─────────────────────────────────────────────────────────────────────────────────┐ │
│ │ * 14:35:22  tools/call         echo                               [Replay] [Pin] │ │
│ │    Parameters: { "message": "Hello world" }                                     │ │
│ │    Result: ✓ Success (45ms)                                                     │ │
│ │    ──────────────────────────────────────────────────────────────────────────── │ │
│ │    Response: { "content": [{ "type": "text", "text": "Hello world" }] }         │ │
│ └─────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                     │
│ ┌─────────────────────────────────────────────────────────────────────────────────┐ │
│ │    14:34:15  resources/read     file:///config.json               [Replay] [Pin] │ │
│ │    Result: ✓ Success (120ms)                                                    │ │
│ │    ──────────────────────────────────────────────────────────────────────────── │ │
│ │    Content: { "name": "my-app", "version": "1.0.0" }  (collapsed)  [Expand]     │ │
│ └─────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                     │
│ ┌─────────────────────────────────────────────────────────────────────────────────┐ │
│ │    14:33:45  prompts/get        greeting_prompt                   [Replay] [Pin] │ │
│ │    Arguments: { "name": "John", "interests": "cats" }                           │ │
│ │    Result: ✓ Success (30ms)                                                     │ │
│ └─────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                     │
│ ┌─────────────────────────────────────────────────────────────────────────────────┐ │
│ │    14:32:10  tools/call         query_database                    [Replay] [Pin] │ │
│ │    Parameters: { "table": "users", "limit": 10 }                                │ │
│ │    Result: ✗ Error (200ms)                                                      │ │
│ │    ──────────────────────────────────────────────────────────────────────────── │ │
│ │    Error: "Table 'users' not found"                                             │ │
│ └─────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                     │
│ Pinned Requests (2)                                                                 │
│ ┌─────────────────────────────────────────────────────────────────────────────────┐ │
│ │ * "Test echo"      tools/call    echo             14:35:22       [Replay] [Unpin] │
│ │ * "Get config"     resources/read file:///config.json 14:34:15  [Replay] [Unpin] │
│ └─────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                     │
│                                                          Showing 50 of 127 entries │
│                                                               [Load More]          │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

**Features:**
- **Automatic Capture** - All MCP requests/responses logged automatically:
  - `tools/call` - Tool invocations
  - `resources/read` - Resource reads
  - `prompts/get` - Prompt retrievals
  - `sampling/createMessage` - Sampling requests/responses
  - `elicitation/create` - Elicitation requests/responses
- **Request Details** displayed:
  - Timestamp
  - Method name
  - Target (tool name, resource URI, prompt name)
  - Parameters/arguments
  - Result status (success/error)
  - Response time
  - Response data (collapsible)
- **Replay** - Re-execute any request with original parameters:
  - Opens relevant screen (Tools, Resources, Prompts) pre-filled
  - Option to modify parameters before replay
- **Pin/Save** - Pin important requests for quick access:
  - Pinned requests persist across sessions
  - Optional custom label for pinned items
  - Pinned section at bottom for easy access
- **Filter** by:
  - Method type (tools, resources, prompts, sampling, elicitation)
  - Status (success, error)
  - Time range
- **Search** across method names, parameters, and responses
- **Pagination** - Load more for large histories
- **Clear** - Clear history (with confirmation)
- **Export** - Export history as JSON for sharing/debugging

**Replay Workflow:**
1. Click [Replay] on any history entry
2. Inspector navigates to the appropriate screen (Tools, Resources, Prompts)
3. Form is pre-filled with the original parameters
4. User can modify parameters or execute immediately
5. New request is added to history

### Client Feature Handlers

These are modals/panels that appear when the server invokes client capabilities.

#### Sampling Panel

When server sends `sampling/createMessage` request:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Sampling Request                                                    [x]  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ The server is requesting an LLM completion.                             │
│                                                                         │
│ Messages:                                                               │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ [0] role: user                                                      │ │
│ │     "Analyze this data and provide insights about the trends..."    │ │
│ │                                                                     │ │
│ │ [1] role: user                                                      │ │
│ │     [Image: data_chart.png - Click to preview]                      │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ Model Preferences:                                                      │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ Hints: ["claude-3-sonnet", "gpt-4"]                                 │ │
│ │ Cost Priority: low (0.2)                                            │ │
│ │ Speed Priority: medium (0.5)                                        │ │
│ │ Intelligence Priority: high (0.8)                                   │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ Parameters:                                                             │
│   Max Tokens: 1000                                                      │
│   Stop Sequences: ["\n\n", "END"]                                       │
│   Temperature: (not specified)                                          │
│                                                                         │
│ Include Context: ☑ thisServer                                           │
│                                                                         │
│ ─────────────────────────────────────────────────────────────────────   │
│                                                                         │
│ Response (enter mock response or connect to LLM):                       │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ Based on the data chart, I can see several key trends:              │ │
│ │                                                                     │ │
│ │ 1. Revenue has increased 25% quarter-over-quarter                   │ │
│ │ 2. User engagement peaks on Tuesdays...                             │ │
│ │                                                                     │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ Model Used: ________________    Stop Reason: [end_turn ▼]               │
│                                                                         │
│                                      [Reject Request]  [Send Response]  │
└─────────────────────────────────────────────────────────────────────────┘
```

**Features:**
- Display full sampling request details:
  - Messages with text, image, and audio content
  - Model hints and preferences
  - Max tokens, stop sequences, temperature
  - Context inclusion settings
- **Editable response field** for mock LLM testing
- Model and stop reason fields for response
- **Approve/Reject** with human-in-the-loop
- Image/audio preview in messages
- Option to integrate with real LLM (deferred to plugins)

#### Elicitation Handler

When server sends `elicitation/create` request:

**Form Mode:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Server Request: User Input Required                                 [x]  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ "Please provide your database connection details to proceed."           │
│                                                                         │
│ ─────────────────────────────────────────────────────────────────────   │
│                                                                         │
│ Host *                                                                  │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ localhost                                                           │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ Port *                                                                  │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ 5432                                                                │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ Database                                                                │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ myapp_production                                                    │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ SSL Mode                                                                │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ require                                                           ▼ │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ WARNING: Only provide information you trust this server with.          │
│    The server "{server_name}" is requesting this data.                 │
│                                                                         │
│                                              [Cancel]  [Submit]         │
└─────────────────────────────────────────────────────────────────────────┘
```

**URL Mode:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Server Request: External Action Required                            [x]  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ "Please complete the OAuth authorization in your browser."              │
│                                                                         │
│ ─────────────────────────────────────────────────────────────────────   │
│                                                                         │
│ The server is requesting you visit:                                     │
│                                                                         │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ https://auth.example.com/oauth/authorize?client_id=abc&state=xyz    │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                            [Copy URL]   │
│                                                                         │
│                           [Open in Browser]                             │
│                                                                         │
│ ─────────────────────────────────────────────────────────────────────   │
│                                                                         │
│ Status: Waiting for completion...                        ◌ (spinning)   │
│                                                                         │
│ Elicitation ID: abc123-def456                                           │
│                                                                         │
│ WARNING: This will open an external URL. Verify the domain before proceeding.
│                                                                         │
│                                              [Cancel]                   │
└─────────────────────────────────────────────────────────────────────────┘
```

**Features:**
- **Form Mode:**
  - Generate form from JSON Schema in request
  - Validate input before submission
  - Required field indicators
  - Security warning with server name
  - Submit returns response to server
- **URL Mode:**
  - Display URL for user to visit
  - Copy URL button
  - Open in browser button
  - Waiting indicator until `notifications/elicitation/complete` received
  - Elicitation ID display
  - Domain verification warning
- **Cancel** sends declined response

#### Roots Configuration

Accessed via Settings or Server Info panel:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Roots Configuration                                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ Filesystem roots exposed to the connected server:                       │
│                                                                         │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ Name          URI                                          Actions  │ │
│ ├─────────────────────────────────────────────────────────────────────┤ │
│ │ Project       file:///home/user/myproject               [Remove]    │ │
│ ├─────────────────────────────────────────────────────────────────────┤ │
│ │ Documents     file:///home/user/Documents               [Remove]    │ │
│ ├─────────────────────────────────────────────────────────────────────┤ │
│ │ Config        file:///etc/myapp                         [Remove]    │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ [+ Add Root]                                                            │
│                                                                         │
│ ─────────────────────────────────────────────────────────────────────   │
│                                                                         │
│ Add New Root:                                                           │
│                                                                         │
│ Name:                                                                   │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ Downloads                                                           │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ Path:                                                                   │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ /home/user/Downloads                                                │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                        [Browse] [Add]   │
│                                                                         │
│ WARNING: Roots give the server access to these directories.            │
│ Only add directories you trust the server to access.                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Features:**
- List configured roots with name and URI
- Add new roots:
  - Name field
  - Path field with browse button
- Remove roots
- **Sends `notifications/roots/listChanged`** when roots are modified
- Responds to `roots/list` requests from server
- Security warning about filesystem access

#### Experimental Features Panel

Accessed via Settings or dedicated nav item:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Experimental Features & Advanced Testing                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ WARNING: These features are non-standard and may change or be removed. │
│                                                                         │
│ Server Experimental Capabilities:                                       │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ custom_analytics                                                    │ │
│ │   Description: Custom analytics tracking                            │ │
│ │   Methods: analytics/track, analytics/query                         │ │
│ │                                                            [Test →] │ │
│ ├─────────────────────────────────────────────────────────────────────┤ │
│ │ streaming_v2                                                        │ │
│ │   Description: Enhanced streaming support                           │ │
│ │   Methods: stream/start, stream/stop, stream/data                   │ │
│ │                                                            [Test →] │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ Client Experimental Capabilities (advertised to server):                │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ ☐ custom_analytics                                                  │ │
│ │ ☐ streaming_v2                                                      │ │
│ │ ☐ Add custom capability...                                          │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ ─────────────────────────────────────────────────────────────────────   │
│                                                                         │
│ Advanced JSON-RPC Tester                                                │
│ Send raw JSON-RPC requests to test ANY method (standard or experimental)│
│                                                                         │
│ Custom Headers (optional):                                              │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ X-Debug-Mode         | true                              [Remove]   │ │
│ │ X-Request-ID         | test-123                          [Remove]   │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│ [+ Add Header]                                                          │
│                                                                         │
│ Request:                                                                │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ {                                                                   │ │
│ │   "jsonrpc": "2.0",                                                 │ │
│ │   "id": 1,                                                          │ │
│ │   "method": "tools/call",                                           │ │
│ │   "params": {                                                       │ │
│ │     "name": "echo",                                                 │ │
│ │     "arguments": { "message": "test" },                             │ │
│ │     "_meta": { "progressToken": "abc123" }                          │ │
│ │   }                                                                 │ │
│ │ }                                                                   │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                       [Load from History ▼]  [Send Request]             │
│                                                                         │
│ Response:                                                               │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ {                                                                   │ │
│ │   "jsonrpc": "2.0",                                                 │ │
│ │   "id": 1,                                                          │ │
│ │   "result": {                                                       │ │
│ │     "content": [{ "type": "text", "text": "test" }]                 │ │
│ │   }                                                                 │ │
│ │ }                                                                   │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                              [Copy]     │
│                                                                         │
│ Request History:                                                        │
│   14:32:05 - tools/call (success) 45ms                                  │
│   14:31:22 - resources/list (success) 12ms                              │
│   14:30:01 - experimental/myMethod (error) 200ms                        │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Features:**
- Display server's experimental capabilities from initialization
- Toggle client experimental capabilities to advertise
- Add custom client experimental capabilities
- **Advanced JSON-RPC Tester:**
  - Test ANY JSON-RPC method (not just experimental)
  - **Custom headers** for per-request header injection
  - JSON editor with syntax highlighting
  - Full control over `_meta` and `progressToken` fields
  - [Load from History] to replay previous requests
  - Response display with copy button
  - Request history with method, status, and duration
- **Use Cases:**
  - Testing server behavior with invalid parameters
  - Debugging SDK message formatting (see full request/response)
  - Verifying `_meta`/`progressToken` handling
  - Testing experimental methods before SDK support
  - Comparing behavior across different servers

## Form Generation

Forms are dynamically generated from JSON Schema for tool inputs, prompt arguments, and resource template variables.

**Supported Field Types:**
| JSON Schema Type | Form Control |
|------------------|--------------|
| `string` | Text input |
| `string` (enum) | Select dropdown |
| `string` (enum with `oneOf`) | Select dropdown with titles |
| `array` (enum items with `anyOf`) | Multi-select dropdown or checkboxes |
| `string` (format: uri) | URL input with validation |
| `number` / `integer` | Number input |
| `boolean` | Checkbox or toggle |
| `array` | Dynamic list with add/remove |
| `object` | Nested fieldset |

**Enum Handling (Single and Multi-select):**

The MCP 2025-11-25 spec supports titled enums using `oneOf`/`anyOf`:

```json
// Single-select enum (oneOf) - renders as dropdown
{
  "type": "string",
  "oneOf": [
    { "const": "small", "title": "Small (1-10 items)" },
    { "const": "medium", "title": "Medium (11-100 items)" },
    { "const": "large", "title": "Large (100+ items)" }
  ]
}

// Multi-select enum (anyOf with array) - renders as multi-select or checkboxes
{
  "type": "array",
  "items": {
    "type": "string",
    "anyOf": [
      { "const": "read", "title": "Read access" },
      { "const": "write", "title": "Write access" },
      { "const": "delete", "title": "Delete access" }
    ]
  }
}
```

| Pattern | Form Control |
|---------|--------------|
| `oneOf` with `const` values | Single-select dropdown with titles |
| `anyOf` with `const` values in array items | Multi-select dropdown or checkboxes |
| Legacy `enum` array | Single-select dropdown (no titles) |

Note: For Shadcn, multi-select requires a third-party component (e.g., [shadcn-multi-select](https://shadcn-multi-select-component.vercel.app/)). Mantine has built-in `MultiSelect`.

**Schema Features:**
- `required` - Mark fields as required (*)
- `default` - Pre-fill with default value
- `description` - Show as helper text
- `title` - Display label (used in `oneOf`/`anyOf` for enum titles)
- `enum` - Render as select dropdown
- `minimum` / `maximum` - Validation for numbers
- `minLength` / `maxLength` - Validation for strings

**Complex Schema Handling:**
- `$ref` - Resolve references and render inline (when possible)
- `anyOf` / `oneOf` (non-enum) - Show JSON editor as fallback
- Toggle between form view and JSON editor for complex cases

## Error Handling UX

### Toast Notifications

Transient errors and success messages shown as toasts:

```
┌─────────────────────────────────────────────────────────┐
│ ✓ Connected to everything-server                   [×]  │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ [!] Tool execution failed: Invalid parameters      [x]  │
│    [View Documentation →]                               │
└─────────────────────────────────────────────────────────┘
```

### Inline Error Display

Persistent errors shown inline in context (e.g., server cards):

```
┌─────────────────────────────────────────────────────────┐
│ [!] Connection Error                                    │
│                                                         │
│ Failed to connect: ECONNREFUSED                         │
│ Retry attempt 3 of 5                                    │
│                                                         │
│ [Show full error]        [Troubleshooting Guide →]      │
└─────────────────────────────────────────────────────────┘
```

**Error Display Patterns:**
- **Truncation** - Long errors truncated to ~100 chars with "Show more"
- **Retry count** - Display retry attempts for connection errors
- **Doc links** - Contextual links to troubleshooting documentation
- **Expandable** - Click to show full error message/stack trace

### Connection States

Clear visual feedback for connection lifecycle:

| State | Visual | User Action |
|-------|--------|-------------|
| Disconnected | Gray status, toggle off | Click toggle to connect |
| Connecting | Yellow pulsing, spinner | Wait or cancel |
| Connected | Green status, toggle on | Click toggle to disconnect |
| Failed | Red status, error shown | Retry or edit config |
| OAuth Flow | Redirect indicator | Complete OAuth in browser |

## MCP Protocol Coverage

This UX specification covers **100% of the MCP 2025-11-25 protocol specification**.

### Request Methods

| Method | UX Location |
|--------|-------------|
| `initialize` | Connection flow (implicit) |
| `ping` | Navigation bar latency display |
| `tools/list` | Tools Screen |
| `tools/call` | Tools Screen |
| `resources/list` | Resources Screen |
| `resources/templates/list` | Resources Screen (templates section) |
| `resources/read` | Resources Screen |
| `resources/subscribe` | Resources Screen |
| `resources/unsubscribe` | Resources Screen |
| `prompts/list` | Prompts Screen |
| `prompts/get` | Prompts Screen |
| `sampling/createMessage` | Sampling Panel |
| `elicitation/create` | Elicitation Handler |
| `completion/complete` | Tools/Prompts autocomplete |
| `logging/setLevel` | Logging Screen |
| `roots/list` | Roots Configuration |
| `tasks/list` | Tasks Screen |
| `tasks/get` | Tasks Screen |
| `tasks/result` | Tasks Screen |
| `tasks/cancel` | Tasks Screen |

### Notification Methods

| Notification | UX Location |
|--------------|-------------|
| `notifications/initialized` | Connection flow (implicit) |
| `notifications/progress` | Tools Screen progress bar, Tasks Screen |
| `notifications/cancelled` | Tools Screen cancel button |
| `notifications/message` | Logging Screen |
| `notifications/tools/list_changed` | Tools Screen indicator |
| `notifications/resources/list_changed` | Resources Screen indicator |
| `notifications/prompts/list_changed` | Prompts Screen indicator |
| `notifications/resources/updated` | Resources Screen subscriptions |
| `notifications/roots/listChanged` | Roots Configuration |
| `notifications/task/statusChanged` | Tasks Screen |
| `notifications/elicitation/complete` | Elicitation Handler (URL mode) |

### Capabilities

| Capability | Type | UX Location |
|------------|------|-------------|
| `tools` | Server | Tools Screen, Server Info |
| `resources` | Server | Resources Screen, Server Info |
| `prompts` | Server | Prompts Screen, Server Info |
| `logging` | Server | Logging Screen, Server Info |
| `completions` | Server | Forms autocomplete, Server Info |
| `tasks` | Server | Tasks Screen, Server Info |
| `experimental` | Server | Experimental Features Panel, Server Info |
| `sampling` | Client | Sampling Panel, Server Info |
| `elicitation` | Client | Elicitation Handler, Server Info |
| `roots` | Client | Roots Configuration, Server Info |
| `tasks` | Client | Tasks Screen, Server Info |
| `experimental` | Client | Experimental Features Panel, Server Info |

### Content Types

| Content Type | UX Location |
|--------------|-------------|
| Text | All screens (default) |
| Image (base64) | Tools results, Prompts messages, Resources |
| Audio (base64) | Tools results, Prompts messages, Resources |
| Resource links | Tools results, embedded display |
| Embedded resources | Prompts messages |

### Annotations

| Annotation | UX Location |
|------------|-------------|
| Tool audience | Tools Screen badges |
| Tool hints | Tools Screen description |
| Tool readOnly | Tools Screen indicator |
| Tool destructive | Tools Screen warning |
| Resource audience | Resources Screen badges |
| Resource priority | Resources Screen indicator |
