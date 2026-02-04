# Inspector V2 UX - Handlers & Patterns

### [Brief](README.md) | [V1 Problems](v1_problems.md) | [V2 Scope](v2_scope.md) | [V2 Tech Stack](v2_tech_stack.md)
### UX: [Overview](v2_ux.md) | [Features](v2_ux_features.md) | Handlers | [Screenshots](v2_screenshots.md)

---

## Table of Contents
  * [Client Feature Handlers](#client-feature-handlers)
    * [Sampling Panel](#sampling-panel)
    * [Elicitation Handler](#elicitation-handler)
    * [Roots Configuration](#roots-configuration)
    * [Experimental Features Panel](#experimental-features-panel)
  * [Sampling Providers & Testing Profiles](#sampling-providers--testing-profiles)
  * [Form Generation](#form-generation)
  * [Error Handling UX](#error-handling-ux)

## Client Feature Handlers

These are modals/panels that appear when the server invokes client capabilities.

### Sampling Panel

Sampling requests appear in two contexts:

1. **Inline** - When triggered during tool execution (shown in Tools screen)
2. **Modal** - For standalone testing or when triggered outside tool context

#### Inline Expansion (Primary)

When a tool call triggers a sampling request, it appears inline within the tool execution flow:

```
+-------------------------------------------------------------------------+
| Tool: query_database                                     [Executing...] |
+-------------------------------------------------------------------------+
| Parameters: { "table": "users", "limit": 10 }                           |
+-------------------------------------------------------------------------+
| [!] Sampling Request                           [Profile: Quick Mock v]  |
|                                                                         |
| +---------------------------------------------------------------------+ |
| | Model hints: claude-3-sonnet, gpt-4                                 | |
| | Messages: "Analyze this database schema and recommend an index..."  | |
| |                                                      [View Details] | |
| +---------------------------------------------------------------------+ |
|                                                                         |
| Response:                                                               |
| +---------------------------------------------------------------------+ |
| | Based on the query patterns, I recommend creating a composite       | |
| | index on (user_id, created_at) for optimal performance...           | |
| +---------------------------------------------------------------------+ |
|                                                                         |
| Model Used: [mock-model-1.0]    Stop Reason: [end_turn v]               |
|                                                                         |
|                     [Auto-respond]  [Edit & Send]  [Reject]             |
+-------------------------------------------------------------------------+
```

**Inline Features:**
- Compact view showing essential info (model hints, message preview)
- [View Details] expands to show full request (like modal view)
- **Testing Profile** dropdown to quickly switch response behavior
- **[Auto-respond]** uses active Testing Profile to generate response
- **[Edit & Send]** allows modifying response before sending
- **[Reject]** declines the sampling request
- Response field pre-filled based on active Testing Profile

#### Modal View (Standalone Testing)

For testing sampling outside of tool execution, or when [View Details] is clicked:

```
+-------------------------------------------------------------------------+
| Sampling Request                                                    [x] |
+-------------------------------------------------------------------------+
|                                                                         |
| The server is requesting an LLM completion.                             |
|                                                                         |
| Messages:                                                               |
| +---------------------------------------------------------------------+ |
| | [0] role: user                                                      | |
| |     "Analyze this data and provide insights about the trends..."    | |
| |                                                                     | |
| | [1] role: user                                                      | |
| |     [Image: data_chart.png - Click to preview]                      | |
| +---------------------------------------------------------------------+ |
|                                                                         |
| Model Preferences:                                                      |
| +---------------------------------------------------------------------+ |
| | Hints: ["claude-3-sonnet", "gpt-4"]                                 | |
| | Cost Priority: low (0.2)                                            | |
| | Speed Priority: medium (0.5)                                        | |
| | Intelligence Priority: high (0.8)                                   | |
| +---------------------------------------------------------------------+ |
|                                                                         |
| Parameters:                                                             |
|   Max Tokens: 1000                                                      |
|   Stop Sequences: ["\n\n", "END"]                                       |
|   Temperature: (not specified)                                          |
|                                                                         |
| Include Context: [x] thisServer                                         |
|                                                                         |
| ----------------------------------------------------------------------- |
|                                                                         |
| Testing Profile: [Quick Mock v]                        [Edit Profiles]  |
|                                                                         |
| Response:                                                               |
| +---------------------------------------------------------------------+ |
| | Based on the data chart, I can see several key trends:              | |
| |                                                                     | |
| | 1. Revenue has increased 25% quarter-over-quarter                   | |
| | 2. User engagement peaks on Tuesdays...                             | |
| |                                                                     | |
| +---------------------------------------------------------------------+ |
|                                                                         |
| Model Used: [mock-model-1.0]    Stop Reason: [end_turn v]               |
|                                                                         |
|              [Auto-respond]  [Reject Request]  [Send Response]          |
+-------------------------------------------------------------------------+
```

**Modal Features:**
- Display full sampling request details:
  - Messages with text, image, and audio content
  - Model hints and preferences (cost, speed, intelligence priorities)
  - Max tokens, stop sequences, temperature
  - Context inclusion settings
  - **Tools** and **toolChoice** (if provided) for tool-enabled sampling
- **Testing Profile** selector with [Edit Profiles] link
- **[Auto-respond]** generates response from active profile
- **Editable response field** for mock LLM testing
- Model and stop reason fields for response
- **Approve/Reject** with human-in-the-loop
- Image/audio preview in messages
- Integration with Testing Profiles (see below)

#### Sampling with Tool Calling (2025-11-25)

Sampling requests can include `tools` and `toolChoice` parameters, enabling multi-turn agentic loops where the LLM can request tool execution.

**Request with Tools:**

```
+-------------------------------------------------------------------------+
| Sampling Request (with tools)                                       [x] |
+-------------------------------------------------------------------------+
|                                                                         |
| Messages:                                                               |
| +---------------------------------------------------------------------+ |
| | [0] role: user                                                      | |
| |     "What's the weather in Paris and London?"                       | |
| +---------------------------------------------------------------------+ |
|                                                                         |
| Available Tools (2):                                                    |
| +---------------------------------------------------------------------+ |
| | get_weather                                                         | |
| |   Get current weather for a city                                    | |
| |   Parameters: { city: string }                                      | |
| +---------------------------------------------------------------------+ |
| | get_forecast                                                        | |
| |   Get 5-day forecast for a city                                     | |
| |   Parameters: { city: string, days: number }                        | |
| +---------------------------------------------------------------------+ |
|                                                                         |
| Tool Choice: [auto v]  (auto | none | required | specific tool)         |
|                                                                         |
+-------------------------------------------------------------------------+
```

**Response with Tool Use:**

When the LLM wants to call tools, the response includes `stopReason: "toolUse"`:

```
+-------------------------------------------------------------------------+
| Sampling Response                                                       |
+-------------------------------------------------------------------------+
|                                                                         |
| Response Content:                                                       |
| +---------------------------------------------------------------------+ |
| | I'll check the weather for both cities.                             | |
| +---------------------------------------------------------------------+ |
|                                                                         |
| Tool Calls Requested:                                                   |
| +---------------------------------------------------------------------+ |
| | [1] get_weather({ "city": "Paris" })                                | |
| | [2] get_weather({ "city": "London" })                               | |
| +---------------------------------------------------------------------+ |
|                                                                         |
| Model Used: [claude-3-sonnet]    Stop Reason: [toolUse]                 |
|                                                                         |
| [!] Server must execute tools and send follow-up sampling request       |
|                                                                         |
|                                      [Reject Request]  [Send Response]  |
+-------------------------------------------------------------------------+
```

**Multi-Turn Tool Loop Flow:**

```
Server                              Client (Inspector)
  |                                        |
  |  sampling/createMessage (with tools)   |
  |--------------------------------------->|
  |                                        |  [User reviews request]
  |                                        |  [User approves/provides response]
  |      Response (stopReason: toolUse)    |
  |<---------------------------------------|
  |                                        |
  |  [Server executes requested tools]     |
  |                                        |
  |  sampling/createMessage                |
  |  (history + tool_results + tools)      |
  |--------------------------------------->|
  |                                        |  [User reviews continuation]
  |      Response (stopReason: endTurn)    |
  |<---------------------------------------|
  |                                        |
  |  [Server processes final response]     |
```

**Tool Results in Follow-up Request:**

The server sends tool results back in a continuation request:

```
+-------------------------------------------------------------------------+
| Sampling Request (continuation with tool results)                   [x] |
+-------------------------------------------------------------------------+
|                                                                         |
| Messages:                                                               |
| +---------------------------------------------------------------------+ |
| | [0] role: user                                                      | |
| |     "What's the weather in Paris and London?"                       | |
| |                                                                     | |
| | [1] role: assistant                                                 | |
| |     "I'll check the weather for both cities."                       | |
| |     Tool calls: get_weather(Paris), get_weather(London)             | |
| |                                                                     | |
| | [2] role: user (tool_result)                                        | |
| |     get_weather(Paris): { "temp": 18, "conditions": "Sunny" }       | |
| |     get_weather(London): { "temp": 14, "conditions": "Cloudy" }     | |
| +---------------------------------------------------------------------+ |
|                                                                         |
| Available Tools (2): [same as before]                                   |
|                                                                         |
+-------------------------------------------------------------------------+
```

**History View:**

The History screen shows the complete tool loop as a nested chain:

```
[>] 14:35:22  tools/call  weather_report        [success] 2.5s  [Replay]
    +-- 14:35:23  sampling/createMessage (with tools)         [+100ms]
    |     Response: toolUse - get_weather(Paris), get_weather(London)
    +-- 14:35:24  [tool execution: get_weather x2]            [+500ms]
    +-- 14:35:25  sampling/createMessage (continuation)       [+1.2s]
    |     Response: "Paris is 18C and sunny, London is 14C and cloudy"
```

### Elicitation Handler

Elicitation requests appear in two contexts:

1. **Inline** - When triggered during tool execution (shown in Tools screen)
2. **Modal** - For standalone testing or when triggered outside tool context

#### Inline Expansion (Form Mode)

When a tool call triggers a form elicitation, it appears inline:

```
+-------------------------------------------------------------------------+
| Tool: process_data                                       [Executing...] |
+-------------------------------------------------------------------------+
| Parameters: { "dataset": "quarterly_sales" }                            |
+-------------------------------------------------------------------------+
| [!] Elicitation Request (form)                                          |
|                                                                         |
| "Please confirm the data processing parameters."                        |
|                                                                         |
| +---------------------------------------------------------------------+ |
| | include_deleted: [ ] No    output_format: [CSV v]                   | |
| | date_range: [2024-01-01] to [2024-12-31]                            | |
| +---------------------------------------------------------------------+ |
|                                                                         |
| WARNING: Server "data-processor" is requesting this data.               |
|                                                                         |
|                                              [Cancel]  [Submit]         |
+-------------------------------------------------------------------------+
```

#### Inline Expansion (URL Mode)

When a tool call triggers a URL elicitation:

```
+-------------------------------------------------------------------------+
| Tool: connect_oauth                                      [Executing...] |
+-------------------------------------------------------------------------+
| Parameters: { "provider": "github" }                                    |
+-------------------------------------------------------------------------+
| [!] Elicitation Request (external URL)                                  |
|                                                                         |
| "Please complete OAuth authorization."                                  |
|                                                                         |
| URL: https://github.com/login/oauth/authorize?...         [Copy] [Open] |
|                                                                         |
| Status: Waiting for completion...                          (spinning)   |
|                                                                         |
|                                                            [Cancel]     |
+-------------------------------------------------------------------------+
```

#### Modal View - Form Mode

For standalone testing or expanded view:

```
+-------------------------------------------------------------------------+
| Server Request: User Input Required                                 [x] |
+-------------------------------------------------------------------------+
|                                                                         |
| "Please provide your database connection details to proceed."           |
|                                                                         |
| ----------------------------------------------------------------------- |
|                                                                         |
| Host *                                                                  |
| +---------------------------------------------------------------------+ |
| | localhost                                                           | |
| +---------------------------------------------------------------------+ |
|                                                                         |
| Port *                                                                  |
| +---------------------------------------------------------------------+ |
| | 5432                                                                | |
| +---------------------------------------------------------------------+ |
|                                                                         |
| Database                                                                |
| +---------------------------------------------------------------------+ |
| | myapp_production                                                    | |
| +---------------------------------------------------------------------+ |
|                                                                         |
| SSL Mode                                                                |
| +---------------------------------------------------------------------+ |
| | require                                                           v | |
| +---------------------------------------------------------------------+ |
|                                                                         |
| WARNING: Only provide information you trust this server with.           |
|    The server "{server_name}" is requesting this data.                  |
|                                                                         |
|                                              [Cancel]  [Submit]         |
+-------------------------------------------------------------------------+
```

#### Modal View - URL Mode

```
+-------------------------------------------------------------------------+
| Server Request: External Action Required                            [x] |
+-------------------------------------------------------------------------+
|                                                                         |
| "Please complete the OAuth authorization in your browser."              |
|                                                                         |
| ----------------------------------------------------------------------- |
|                                                                         |
| The server is requesting you visit:                                     |
|                                                                         |
| +---------------------------------------------------------------------+ |
| | https://auth.example.com/oauth/authorize?client_id=abc&state=xyz    | |
| +---------------------------------------------------------------------+ |
|                                                            [Copy URL]   |
|                                                                         |
|                           [Open in Browser]                             |
|                                                                         |
| ----------------------------------------------------------------------- |
|                                                                         |
| Status: Waiting for completion...                        (spinning)     |
|                                                                         |
| Elicitation ID: abc123-def456                                           |
|                                                                         |
| WARNING: This will open an external URL. Verify the domain before       |
| proceeding.                                                             |
|                                                                         |
|                                              [Cancel]                   |
+-------------------------------------------------------------------------+
```

**Features:**

- **Inline Display:**
  - Compact form showing essential fields
  - Integrated with tool execution flow
  - Clear connection between tool call and elicitation
  - Same submit/cancel behavior as modal

- **Form Mode:**
  - Generate form from JSON Schema in request
  - **Schema restriction:** Flat objects with primitive properties only (string, number, boolean, enum) - no nested objects or arrays
  - Validate input before submission
  - Required field indicators
  - Security warning with server name
  - Submit returns response to server
  - Response `action`: "accept" | "decline" | "cancel"

- **URL Mode:**
  - Display URL for user to visit
  - Copy URL button
  - Open in browser button
  - Waiting indicator until `notifications/elicitation/complete` received
  - Elicitation ID display
  - Domain verification warning

- **Cancel** sends declined response

### Roots Configuration

Accessed via Settings or Server Info panel:

```
+-------------------------------------------------------------------------+
| Roots Configuration                                                     |
+-------------------------------------------------------------------------+
|                                                                         |
| Filesystem roots exposed to the connected server:                       |
|                                                                         |
| +---------------------------------------------------------------------+ |
| | Name          URI                                          Actions  | |
| +---------------------------------------------------------------------+ |
| | Project       file:///home/user/myproject               [Remove]    | |
| +---------------------------------------------------------------------+ |
| | Documents     file:///home/user/Documents               [Remove]    | |
| +---------------------------------------------------------------------+ |
| | Config        file:///etc/myapp                         [Remove]    | |
| +---------------------------------------------------------------------+ |
|                                                                         |
| [+ Add Root]                                                            |
|                                                                         |
| ----------------------------------------------------------------------- |
|                                                                         |
| Add New Root:                                                           |
|                                                                         |
| Name:                                                                   |
| +---------------------------------------------------------------------+ |
| | Downloads                                                           | |
| +---------------------------------------------------------------------+ |
|                                                                         |
| Path:                                                                   |
| +---------------------------------------------------------------------+ |
| | /home/user/Downloads                                                | |
| +---------------------------------------------------------------------+ |
|                                                        [Browse] [Add]   |
|                                                                         |
| WARNING: Roots give the server access to these directories.             |
| Only add directories you trust the server to access.                    |
|                                                                         |
+-------------------------------------------------------------------------+
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

### Experimental Features Panel

Accessed via Settings or dedicated nav item:

```
+-------------------------------------------------------------------------+
| Experimental Features & Advanced Testing                                |
+-------------------------------------------------------------------------+
|                                                                         |
| WARNING: These features are non-standard and may change or be removed.  |
|                                                                         |
| Server Experimental Capabilities:                                       |
| +---------------------------------------------------------------------+ |
| | custom_analytics                                                    | |
| |   Description: Custom analytics tracking                            | |
| |   Methods: analytics/track, analytics/query                         | |
| |                                                            [Test ->] | |
| +---------------------------------------------------------------------+ |
| | streaming_v2                                                        | |
| |   Description: Enhanced streaming support                           | |
| |   Methods: stream/start, stream/stop, stream/data                   | |
| |                                                            [Test ->] | |
| +---------------------------------------------------------------------+ |
|                                                                         |
| Client Experimental Capabilities (advertised to server):                |
| +---------------------------------------------------------------------+ |
| | [ ] custom_analytics                                                | |
| | [ ] streaming_v2                                                    | |
| | [ ] Add custom capability...                                        | |
| +---------------------------------------------------------------------+ |
|                                                                         |
| ----------------------------------------------------------------------- |
|                                                                         |
| Advanced JSON-RPC Tester                                                |
| Send raw JSON-RPC requests to test ANY method (standard or experimental)|
|                                                                         |
| Custom Headers (optional):                                              |
| +---------------------------------------------------------------------+ |
| | X-Debug-Mode         | true                              [Remove]   | |
| | X-Request-ID         | test-123                          [Remove]   | |
| +---------------------------------------------------------------------+ |
| [+ Add Header]                                                          |
|                                                                         |
| Request:                                                                |
| +---------------------------------------------------------------------+ |
| | {                                                                   | |
| |   "jsonrpc": "2.0",                                                 | |
| |   "id": 1,                                                          | |
| |   "method": "tools/call",                                           | |
| |   "params": {                                                       | |
| |     "name": "echo",                                                 | |
| |     "arguments": { "message": "test" },                             | |
| |     "_meta": { "progressToken": "abc123" }                          | |
| |   }                                                                 | |
| | }                                                                   | |
| +---------------------------------------------------------------------+ |
|                       [Load from History v]  [Send Request]             |
|                                                                         |
| Response:                                                               |
| +---------------------------------------------------------------------+ |
| | {                                                                   | |
| |   "jsonrpc": "2.0",                                                 | |
| |   "id": 1,                                                          | |
| |   "result": {                                                       | |
| |     "content": [{ "type": "text", "text": "test" }]                 | |
| |   }                                                                 | |
| | }                                                                   | |
| +---------------------------------------------------------------------+ |
|                                                              [Copy]     |
|                                                                         |
| Request History:                                                        |
|   14:32:05 - tools/call (success) 45ms                                  |
|   14:31:22 - resources/list (success) 12ms                              |
|   14:30:01 - experimental/myMethod (error) 200ms                        |
|                                                                         |
+-------------------------------------------------------------------------+
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

## Sampling Providers & Testing Profiles

Testing Profiles allow quick switching between different sampling response strategies.

### Architecture

```
Sampling Providers (built-in for V2):
+-- Manual        - User types each response
+-- Mock/Template - Auto-respond with preconfigured templates

Testing Profiles (saved configurations):
+-- Profile selects a provider
+-- Profile configures that provider's settings
+-- Quick switch between profiles for different testing scenarios
```

### Testing Profiles Settings

```
+-------------------------------------------------------------------------+
| Sampling Settings                                                       |
+-------------------------------------------------------------------------+
|                                                                         |
| Active Profile: [Quick Mock v]                          [+ New Profile] |
|                                                                         |
| Saved Profiles:                                                         |
| +---------------------------------------------------------------------+ |
| | (*) Quick Mock      | Mock, auto-respond, simple template          | |
| | ( ) Detailed Mock   | Mock, model-specific templates               | |
| | ( ) Manual Review   | Manual, no auto-respond                      | |
| +---------------------------------------------------------------------+ |
|                                           [Edit Selected] [Delete]      |
|                                                                         |
+-------------------------------------------------------------------------+
| Profile: Quick Mock                                         [Editing]   |
+-------------------------------------------------------------------------+
|                                                                         |
| Profile Name: [Quick Mock                    ]                          |
|                                                                         |
| Provider: [Mock/Template v]                                             |
|                                                                         |
| [x] Auto-respond to sampling requests                                   |
|                                                                         |
| Default Response Template:                                              |
| +---------------------------------------------------------------------+ |
| | This is a mock LLM response for testing purposes.                   | |
| +---------------------------------------------------------------------+ |
|                                                                         |
| Default Model: [mock-model-1.0           ]                              |
| Default Stop Reason: [end_turn v]                                       |
|                                                                         |
| Model-Specific Overrides:                                   [+ Add]     |
| +---------------------------------------------------------------------+ |
| | Pattern        | Response Template                        | Actions | |
| +---------------------------------------------------------------------+ |
| | claude-*       | "I'll analyze this as Claude would..."   | [Edit]  | |
| | gpt-*          | "As an AI assistant, I can help..."      | [Edit]  | |
| +---------------------------------------------------------------------+ |
|                                                                         |
|                                              [Save Profile] [Cancel]    |
+-------------------------------------------------------------------------+
```

### Provider: Manual

User manually enters each sampling response:

- No auto-respond
- Response field starts empty
- User must type or paste response
- Best for careful testing of specific responses

### Provider: Mock/Template

Automatically generates responses based on templates:

- **Auto-respond** enabled by default
- Default template used for all requests (unless overridden)
- **Model-specific overrides** match model hints with patterns:
  - `claude-*` matches any Claude model hint
  - `gpt-*` matches any GPT model hint
  - First matching pattern wins
- Response pre-filled in UI (user can still edit before sending)

### Profile Switching

Profiles can be switched from:

1. **Sampling Settings** panel (global)
2. **Inline sampling request** dropdown (per-request override)
3. **Modal sampling view** dropdown

### Extension Points (Future)

The provider interface is designed for future plugin extensions:

```typescript
interface SamplingProvider {
  name: string;
  description: string;
  configure(): ProviderConfig;  // Returns config UI schema
  respond(request: SamplingRequest, config: ProviderConfig): Promise<SamplingResponse>;
}
```

**Built-in providers (V2):**
- Manual
- Mock/Template

**Future plugin examples:**
- OpenAI Provider (forwards to OpenAI API)
- Anthropic Provider (forwards to Claude API)
- Ollama Provider (local LLM)
- Custom Provider (user-defined handler)

When plugins are installed, they appear as additional provider options in the profile configuration.

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
+-----------------------------------------------------------+
| [check] Connected to everything-server                 [x] |
+-----------------------------------------------------------+

+-----------------------------------------------------------+
| [!] Tool execution failed: Invalid parameters          [x] |
|    [View Documentation ->]                                 |
+-----------------------------------------------------------+
```

### Inline Error Display

Persistent errors shown inline in context (e.g., server cards):

```
+-----------------------------------------------------------+
| [!] Connection Error                                       |
|                                                            |
| Failed to connect: ECONNREFUSED                            |
| Retry attempt 3 of 5                                       |
|                                                            |
| [Show full error]        [Troubleshooting Guide ->]        |
+-----------------------------------------------------------+
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
