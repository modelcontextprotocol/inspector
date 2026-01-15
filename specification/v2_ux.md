# Inspector V2 UX Specification

### [Brief](README.md) | [V1 Problems](v1_problems.md) | [V2 Scope](v2_scope.md) | [V2 Tech Stack](v2_tech_stack.md) | V2 UX

## Table of Contents
  * [Design Principles](#design-principles)
  * [Navigation Model](#navigation-model)
  * [Screen Flows](#screen-flows)
    * [Server List (Home)](#server-list-home)
    * [Server Connection Card](#server-connection-card)
    * [Import server.json Modal](#import-serverjson-modal)
    * [Server Info (Connected)](#server-info-connected)
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
┌─────────────────────────────────────────────────────────┐
│ [Icon] Server Name              v1.0.0                  │
│        STDIO                    [●] Connected  [Toggle] │
├─────────────────────────────────────────────────────────┤
│ npx -y @modelcontextprotocol/server-everything    [Copy]│
├─────────────────────────────────────────────────────────┤
│ [Server Info]                          [Edit] [Remove]  │
└─────────────────────────────────────────────────────────┘
```

**With Error State:**
```
┌─────────────────────────────────────────────────────────┐
│ [Icon] Server Name              v1.0.0                  │
│        HTTP                     [●] Failed (3) [Toggle] │
├─────────────────────────────────────────────────────────┤
│ https://api.example.com/mcp                       [Copy]│
├─────────────────────────────────────────────────────────┤
│ [Server Info]                          [Edit] [Remove]  │
├─────────────────────────────────────────────────────────┤
│ [!] Connection timeout after 20s                       │
│ [Show more]              [View Troubleshooting Guide →] │
└─────────────────────────────────────────────────────────┘
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
- **Edit** - Opens edit server modal
- **Remove** - Deletes server (with confirmation)

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

**With Pending Client Requests (inline expansion):**

When a tool execution triggers sampling or elicitation requests, they appear inline:

```
┌─────────────────┬────────────────────────────────────────────────────────────────┐
│ Tools (4)       │ Tool: query_database                           [Executing...] │
│                 ├────────────────────────────────────────────────────────────────┤
│ [Search...]     │ Parameters: { "table": "users", "limit": 10 }                  │
│                 ├────────────────────────────────────────────────────────────────┤
│ ● query_db      │ [!] Pending Client Requests (2)                                │
│ ○ echo          │                                                                │
│ ○ add           │ ┌──────────────────────────────────────────────────────────┐   │
│ ○ longOp        │ │ sampling/createMessage                       [1 of 2]    │   │
│                 │ │ Model hints: claude-3-sonnet                              │   │
│                 │ │ Messages: "Analyze this database schema..."               │   │
│                 │ │                                                           │   │
│                 │ │ Response:  [Testing Profile: Quick Mock]                  │   │
│                 │ │ ┌───────────────────────────────────────────────────────┐ │   │
│                 │ │ │ This is a mock LLM response for testing purposes.    │ │   │
│                 │ │ └───────────────────────────────────────────────────────┘ │   │
│                 │ │                                                           │   │
│                 │ │            [Auto-respond]  [Edit & Send]  [Reject]        │   │
│                 │ └──────────────────────────────────────────────────────────┘   │
│                 │                                                                │
│                 │ ┌──────────────────────────────────────────────────────────┐   │
│                 │ │ elicitation/create (form)                    [2 of 2]    │   │
│                 │ │ Message: "Please confirm the query parameters"            │   │
│                 │ │                                                           │   │
│                 │ │ table: [users     ]  limit: [10]  [x] include_deleted     │   │
│                 │ │                                                           │   │
│                 │ │                                  [Cancel]  [Submit]       │   │
│                 │ └──────────────────────────────────────────────────────────┘   │
│                 │                                                                │
│                 │                                              [Cancel Tool]     │
└─────────────────┴────────────────────────────────────────────────────────────────┘
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
- **Progress Indicator** from `notifications/progress`:
  - Progress bar with percentage
  - Step description if provided
  - Elapsed time display
- Execute button with loading state
- **Cancel button** sends `notifications/cancelled`
- **Inline Client Request Queue** - When tool triggers sampling/elicitation:
  - Pending requests shown inline (not as separate modal)
  - Queue counter shows total pending requests
  - Each request shows type, summary, and response options
  - **Auto-respond** button uses active Testing Profile
  - **Edit & Send** allows modifying response before sending
  - Requests processed in order, tool execution resumes after all resolved
  - Visible connection between tool call and its triggered requests
- **Rich Result Display**:
  - JSON/text with syntax highlighting
  - Image preview for image content (base64)
  - Audio player for audio content (base64)
  - Resource links displayed as clickable references

#### Resources Screen

```
┌─────────────────────────┬─────────────────────────────────────────────────┐
│ Resources (12)          │ Content Preview (65%)                           │
│ ● List updated          │                                                 │
│ [Refresh Now]           │                                                 │
├─────────────────────────┼─────────────────────────────────────────────────┤
│                         │                                                 │
│ [Search...]             │ URI: file:///config.json                        │
│                         │ MIME: application/json                          │
│ ● config.json           │ ─────────────────────────────                   │
│   [application]        │                                                  │
│   [priority: 0.9]      │ Annotations:                                    │
│                         │   Audience: application                         │
│ ○ readme.md             │   Priority: 0.9 (high)                          │
│   [user]               │                                                  │
│                         │ {                                               │
│ ○ data.csv              │   "name": "my-app",                             │
│                         │   "version": "1.0.0"                            │
│ Templates:              │ }                                               │
│ ○ user/{id}             │                                                 │
│   [id: ________ ] [Go]  │ [Copy] [Subscribe] [Unsubscribe]                │
│                         │                                                 │
│ Subscriptions:          │ Last updated: 14:32:05                          │
│ ● config.json (active)  │                                                 │
│                         │                                                 │
└─────────────────────────┴─────────────────────────────────────────────────┘
```

**Features:**
- **List Changed Indicator** - Shows when `notifications/resources/list_changed` received
- List resources with pagination
- **Resource Annotations** displayed:
  - Audience badge ([user], [application/assistant])
  - Priority indicator ([high], [medium], [low])
- Resource templates with inline variable input
- Subscribe/unsubscribe to resource updates
- **Subscriptions Panel** shows active subscriptions with last update time
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
┌──────────────────────┬──────────────────────────────────────────────────┐
│ Log Controls (25%)   │ Log Stream (75%)                                 │
│ ↔ resize             │                                                  │
├──────────────────────┼──────────────────────────────────────────────────┤
│                      │                                                  │
│ Log Level:           │ 14:32:01 [INFO]  Server initialized              │
│ ┌────────────────┐   │ 14:32:02 [DEBUG] Loading tool: echo              │
│ │ debug        ▼ │   │ 14:32:02 [DEBUG] Loading tool: add               │
│ └────────────────┘   │ 14:32:05 [WARN]  Rate limit approaching          │
│                      │ 14:32:10 [ERROR] Failed to fetch resource: 404   │
│ [Set Level]          │                                                  │
│                      │ ─────────────────────────────────────────────    │
│ Filter:              │                                                  │
│ ┌────────────────┐   │                                                  │
│ │                │   │                                                  │
│ └────────────────┘   │                                                  │
│                      │                                                  │
│ Show Levels:         │                                                  │
│ ☑ DEBUG              │                                                  │
│ ☑ INFO               │                                                  │
│ ☑ WARNING            │                                                  │
│ ☑ ERROR              │                                                  │
│                      │                                                  │
│ Request Filter:      │                                                  │
│ ┌────────────────┐   │                                                  │
│ │ All requests ▼ │   │                                                  │
│ └────────────────┘   │                                                  │
│                      │                                                  │
│ [Clear] [Export]     │ [Auto-scroll ✓] [Copy All]                       │
└──────────────────────┴──────────────────────────────────────────────────┘
```

**With Request Correlation:**

Logs can be filtered by the request that triggered them:

```
┌──────────────────────┬──────────────────────────────────────────────────┐
│ Log Controls (25%)   │ Log Stream (filtered by request)                 │
├──────────────────────┼──────────────────────────────────────────────────┤
│                      │                                                  │
│ Request Filter:      │ Showing logs for: tools/call (query_database)    │
│ ┌────────────────┐   │                               [View in History]  │
│ │ query_database │   │ ─────────────────────────────────────────────    │
│ │   14:32:10   ▼ │   │ 14:32:10 [DEBUG] Starting query execution        │
│ └────────────────┘   │ 14:32:11 [INFO]  Requesting LLM analysis         │
│                      │ 14:32:12 [DEBUG] Sampling response received      │
│ Recent Requests:     │ 14:32:13 [WARN]  Query taking longer than usual  │
│ ○ query_database     │ 14:32:15 [INFO]  Query completed, 42 rows        │
│ ○ analyze_data       │                                                  │
│ ○ prompts/get        │                                                  │
│                      │                                                  │
│ [Show All Logs]      │ [Auto-scroll ✓] [Copy Filtered]                  │
└──────────────────────┴──────────────────────────────────────────────────┘
```

**Features:**
- **Set Log Level** via `logging/setLevel` request
  - Options: debug, info, notice, warning, error, critical, alert, emergency
- **Real-time Log Stream** from `notifications/message`
- Filter by text search
- Filter by log level checkboxes
- Color-coded by severity:
  - DEBUG: gray
  - INFO: blue
  - WARNING: yellow
  - ERROR: red
- Timestamp display
- Logger name display (if provided)
- Auto-scroll toggle
- Export logs to file
- Copy all logs to clipboard
- **Request Correlation**:
  - Filter logs by request (shows logs emitted during a specific tool/resource/prompt call)
  - Recent requests dropdown shows last N requests
  - [View in History] link navigates to the request in History screen
  - Logs include correlation ID linking them to their parent request
  - Click any log entry to see which request chain it belongs to

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

A unified history of all MCP requests with **hierarchical request trace** capability. Shows parent-child relationships when tool calls trigger sampling or elicitation requests.

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│ History                                           [Search...] [Filter ▼] [Clear All] │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                     │
│ [>] 14:35:22  tools/call  query_database         [success] 450ms   [Replay] [Pin]   │
│     +-- 14:35:23  sampling/createMessage  claude-3-sonnet           [+45ms]         │
│     |     Model: claude-3-sonnet-20241022                                           │
│     |     Response: "Based on the schema, I recommend..."         [Expand]          │
│     +-- 14:35:24  sampling/createMessage  gpt-4                     [+120ms]        │
│     |     Model: gpt-4-turbo                                                        │
│     |     Response: "The query should use an index..."            [Expand]          │
│     +-- 14:35:25  elicitation/create  (form: confirm_action)        [+200ms]        │
│           User provided: { confirmed: true }                                        │
│                                                                                     │
│ [>] 14:34:15  resources/read  file:///config.json  [success] 120ms  [Replay] [Pin]  │
│     (no client requests)                                                            │
│                                                                                     │
│ [>] 14:33:45  prompts/get  greeting_prompt        [success] 30ms   [Replay] [Pin]   │
│     Arguments: { "name": "John", "interests": "cats" }                              │
│                                                                                     │
│ [>] 14:32:10  tools/call  analyze_data            [success] 800ms  [Replay] [Pin]   │
│     +-- 14:32:11  sampling/createMessage  claude-3-opus             [+350ms]        │
│     |     Messages: "Analyze this dataset and identify..."                          │
│     |     Response: "I've identified 3 key patterns..."          [Expand]           │
│     +-- 14:32:12  elicitation/create  (url: oauth)                  [+400ms]        │
│           Status: User completed OAuth flow                                         │
│                                                                                     │
│ Pinned Requests (2)                                                                 │
│ ┌─────────────────────────────────────────────────────────────────────────────────┐ │
│ │ * "Test query"     tools/call  query_database    14:35:22      [Replay] [Unpin]  │ │
│ │ * "Get config"     resources/read  config.json   14:34:15      [Replay] [Unpin]  │ │
│ └─────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                     │
│                                                          Showing 50 of 127 entries │
│                                                               [Load More]          │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

**Features:**

- **Request Trace** - Hierarchical view showing causal relationships:
  - Top-level requests (tools/call, resources/read, prompts/get) shown as parent nodes
  - Client requests (sampling, elicitation) shown as nested children with timing offset
  - Expandable/collapsible tree structure
  - Visual connector lines showing the chain
  - **Correlation ID** links related requests together

- **Automatic Capture** - All MCP requests/responses logged automatically:
  - `tools/call` - Tool invocations (parent)
  - `resources/read` - Resource reads (parent)
  - `prompts/get` - Prompt retrievals (parent)
  - `sampling/createMessage` - Sampling requests (child, nested under triggering request)
  - `elicitation/create` - Elicitation requests (child, nested under triggering request)

- **Request Details** displayed:
  - Timestamp (absolute for parents, relative offset for children)
  - Method name
  - Target (tool name, resource URI, prompt name, model hint)
  - Parameters/arguments
  - Result status (success/error)
  - Total response time (for parents), offset time (for children)
  - Response data (collapsible)

- **Replay** - Re-execute any request with original parameters:
  - Opens relevant screen (Tools, Resources, Prompts) pre-filled
  - Option to modify parameters before replay
  - Replaying a parent re-executes the full chain

- **Pin/Save** - Pin important requests for quick access:
  - Pinned requests persist across sessions
  - Optional custom label for pinned items
  - Pinned section at bottom for easy access

- **Filter** by:
  - Method type (tools, resources, prompts, sampling, elicitation)
  - Status (success, error)
  - Time range
  - Show/hide child requests (flatten view)

- **Search** across method names, parameters, and responses
- **Pagination** - Load more for large histories
- **Clear** - Clear history (with confirmation)
- **Export** - Export history as JSON for sharing/debugging

**Replay Workflow:**
1. Click [Replay] on any history entry
2. Inspector navigates to the appropriate screen (Tools, Resources, Prompts)
3. Form is pre-filled with the original parameters
4. User can modify parameters or execute immediately
5. New request is added to history (with any triggered client requests nested)

### Client Feature Handlers

Client feature handlers manage server-initiated requests (sampling, elicitation). They appear in two contexts:

1. **Inline** - When triggered during tool execution, shown within the Tools screen (see [Inline Client Request Queue](#tools-screen))
2. **Modal** - For standalone testing or detailed view

For detailed documentation including Testing Profiles and Sampling Providers, see [v2_ux_handlers.md](v2_ux_handlers.md).

#### Sampling Panel

When server sends `sampling/createMessage` request (modal view shown, inline view in Tools Screen above):

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
- **Testing Profile** selector for quick response strategy switching
- **[Auto-respond]** button generates response from active Testing Profile
- **Editable response field** for mock LLM testing
- Model and stop reason fields for response
- **Approve/Reject** with human-in-the-loop
- Image/audio preview in messages
- Extensible via Sampling Providers (see [v2_ux_handlers.md](v2_ux_handlers.md#sampling-providers--testing-profiles))

#### Elicitation Handler

When server sends `elicitation/create` request (modal views shown, inline views in Tools Screen above):

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
│ Experimental Features                                                   │
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
│ Raw JSON-RPC Tester:                                                    │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ {                                                                   │ │
│ │   "jsonrpc": "2.0",                                                 │ │
│ │   "id": 1,                                                          │ │
│ │   "method": "experimental/myMethod",                                │ │
│ │   "params": {                                                       │ │
│ │     "key": "value"                                                  │ │
│ │   }                                                                 │ │
│ │ }                                                                   │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                        [Send Request]                   │
│                                                                         │
│ Response:                                                               │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ {                                                                   │ │
│ │   "jsonrpc": "2.0",                                                 │ │
│ │   "id": 1,                                                          │ │
│ │   "result": {                                                       │ │
│ │     "status": "success"                                             │ │
│ │   }                                                                 │ │
│ │ }                                                                   │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ Request History:                                                        │
│   14:32:05 - experimental/myMethod (success)                            │
│   14:31:22 - analytics/track (success)                                  │
│   14:30:01 - stream/start (error)                                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Features:**
- Display server's experimental capabilities from initialization
- Toggle client experimental capabilities to advertise
- Add custom client experimental capabilities
- **Raw JSON-RPC Tester:**
  - JSON editor for arbitrary requests
  - Send button
  - Response display
  - Syntax highlighting
  - Request history with timestamps and status
- Test experimental methods directly
- View raw request/response for debugging

## Form Generation

Forms are dynamically generated from JSON Schema for tool inputs, prompt arguments, and resource template variables.

**Supported Field Types:**
| JSON Schema Type | Form Control |
|------------------|--------------|
| `string` | Text input |
| `string` (enum) | Select dropdown |
| `string` (format: uri) | URL input with validation |
| `number` / `integer` | Number input |
| `boolean` | Checkbox or toggle |
| `array` | Dynamic list with add/remove |
| `object` | Nested fieldset |

**Schema Features:**
- `required` - Mark fields as required (*)
- `default` - Pre-fill with default value
- `description` - Show as helper text
- `enum` - Render as select dropdown
- `minimum` / `maximum` - Validation for numbers
- `minLength` / `maxLength` - Validation for strings

**Fallback:**
- For complex schemas (`anyOf`, `oneOf`, `$ref`), show JSON editor as fallback
- Toggle between form view and JSON editor

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
