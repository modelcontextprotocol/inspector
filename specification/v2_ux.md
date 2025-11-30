# Inspector V2 UX Specification

### [Brief](README.md) | [V1 Problems](v1_problems.md) | [V2 Scope](v2_scope.md) | [V2 Tech Stack](v2_tech_stack.md) | V2 UX

## Table of Contents
  * [Design Principles](#design-principles)
  * [Navigation Model](#navigation-model)
  * [Screen Flows](#screen-flows)
    * [Server List (Home)](#server-list-home)
    * [Server Connection Card](#server-connection-card)
    * [Server Info (Connected)](#server-info-connected)
    * [Feature Screens](#feature-screens)
  * [Form Generation](#form-generation)
  * [Error Handling UX](#error-handling-ux)

## Design Principles

- **Single server connection** - No multiple concurrent connections (defer to plugins)
- **MCPJam-inspired** - Use MCPJam Inspector as UX reference model
- **Full-width content** - Maximize screen real estate for each section
- **No sidebar** - Deferred until menu becomes cumbersome or extensions multiply
- **Progressive disclosure** - Show relevant information at each connection stage
- **Resizable panels** - Allow users to adjust panel sizes on feature screens

## Navigation Model

```
┌─────────────────────────────────────────────────────────┐
│  [Server Name ▼]        [Tools] [Resources] [Prompts] [Disconnect]  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│                    Full-width content                   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

- **Menu bar** displays server name and disconnect button when connected
- **Top navigation** links to Tools, Resources, Prompts sections
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
- Add manually (opens form modal)
- Import from JSON (paste/upload config)

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
│ ⚠️ Connection timeout after 20s                        │
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

### Server Info (Connected)

Shown as a modal or dedicated screen after successful connection.

```
┌─────────────────────────────────────────────────────────┐
│  Server Information                              [×]    │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Name:        everything-server                         │
│  Version:     1.0.0                                     │
│  Transport:   stdio                                     │
│                                                         │
│  Capabilities                                           │
│  ─────────────                                          │
│  ✓ Tools (4)                                            │
│  ✓ Resources (12)                                       │
│  ✓ Prompts (2)                                          │
│  ✓ Logging                                              │
│  ✗ Sampling                                             │
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
- Display server metadata and version
- Show capability summary with counts
- Display server instructions if provided
- Show OAuth tokens with copy and JWT decode options

### Feature Screens

Each feature screen uses a **resizable panel layout** for flexibility.

#### Tools Screen

```
┌─────────────┬────────────────────┬──────────────────┐
│ Tool List   │ Parameters         │ Results          │
│ (30%)       │ (40%)              │ (30%)            │
│ ↔ resize    │ ↔ resize           │                  │
├─────────────┼────────────────────┼──────────────────┤
│             │                    │                  │
│ [Search...] │ Tool: echo         │ Output:          │
│             │ ───────────────    │                  │
│ ● echo      │                    │ {                │
│ ○ add       │ message *          │   "content": [   │
│ ○ longOp    │ ┌───────────────┐  │     {            │
│ ○ sampleLLM │ │ Hello world   │  │       "type":    │
│             │ └───────────────┘  │       "text"     │
│             │                    │     }            │
│             │ [Execute Tool]     │   ]              │
│             │                    │ }                │
│             │                    │                  │
│             │                    │ [Copy] [Clear]   │
└─────────────┴────────────────────┴──────────────────┘
```

**Features:**
- Searchable/filterable tool list
- Form generated from tool input schema
- Execute button with loading state
- JSON/text result display
- Support for cancellation of in-progress requests

#### Resources Screen

```
┌──────────────────┬──────────────────────────────────────┐
│ Resources (35%)  │ Content Preview (65%)                │
│ ↔ resize         │                                      │
├──────────────────┼──────────────────────────────────────┤
│                  │                                      │
│ [Search...]      │ URI: file:///config.json             │
│ [Refresh]        │ MIME: application/json               │
│                  │ ─────────────────────────────        │
│ ● config.json    │                                      │
│ ○ readme.md      │ {                                    │
│ ○ data.csv       │   "name": "my-app",                  │
│                  │   "version": "1.0.0"                 │
│ Templates:       │ }                                    │
│ ○ user/{id}      │                                      │
│                  │ [Copy] [Subscribe]                   │
│                  │                                      │
└──────────────────┴──────────────────────────────────────┘
```

**Features:**
- List resources with pagination
- Resource templates with variable input
- Subscribe/unsubscribe to resource updates
- Content viewer (JSON, text, binary preview)

#### Prompts Screen

```
┌─────────────────────────┬───────────────────────────────┐
│ Prompt Selection (35%)  │ Result (65%)                  │
│ ↔ resize                │                               │
├─────────────────────────┼───────────────────────────────┤
│                         │                               │
│ Select Prompt:          │ Messages:                     │
│ ┌─────────────────────┐ │                               │
│ │ greeting_prompt   ▼ │ │ [0] role: user                │
│ └─────────────────────┘ │     "Hello, my name is        │
│                         │      John and I like cats"    │
│ Arguments:              │                               │
│ ─────────────           │ [1] role: assistant           │
│                         │     "Nice to meet you..."     │
│ name *                  │                               │
│ ┌─────────────────────┐ │                               │
│ │ John                │ │                               │
│ └─────────────────────┘ │                               │
│                         │                               │
│ interests               │                               │
│ ┌─────────────────────┐ │                               │
│ │ cats                │ │                               │
│ └─────────────────────┘ │                               │
│                         │                               │
│ [Get Prompt]            │ [Copy]                        │
└─────────────────────────┴───────────────────────────────┘
```

**Features:**
- Dropdown to select from available prompts
- Form generated from prompt arguments
- Display prompt messages result
- Copy functionality

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
│ ⚠️ Tool execution failed: Invalid parameters       [×]  │
│    [View Documentation →]                               │
└─────────────────────────────────────────────────────────┘
```

### Inline Error Display

Persistent errors shown inline in context (e.g., server cards):

```
┌─────────────────────────────────────────────────────────┐
│ ⚠️ Connection Error                                     │
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
