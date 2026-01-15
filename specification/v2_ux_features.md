# Inspector V2 UX - Feature Screens

### [Brief](README.md) | [V1 Problems](v1_problems.md) | [V2 Scope](v2_scope.md) | [V2 Tech Stack](v2_tech_stack.md)
### UX: [Overview](v2_ux.md) | Features | [Handlers](v2_ux_handlers.md) | [Screenshots](v2_screenshots.md)

---

Each feature screen uses a **resizable panel layout** for flexibility.

## Table of Contents
  * [Tools Screen](#tools-screen)
  * [Resources Screen](#resources-screen)
  * [Prompts Screen](#prompts-screen)
  * [Logging Screen](#logging-screen)
  * [Tasks Screen](#tasks-screen)
  * [History Screen](#history-screen)

## Tools Screen

```
+---------------------+--------------------------------------+------------------------+
| Tools (4)           | Parameters                           | Results                |
| [*] List updated    | (40%)                                | (30%)                  |
| [Refresh Now]       | <-> resize                           |                        |
+---------------------+--------------------------------------+------------------------+
|                     |                                      |                        |
| [Search...]         | Tool: query_database                 | Output:                |
|                     | -------------------                  |                        |
| (*) query_db        | Annotations:                         | +------------------+   |
|   [user]            |   Audience: user                     | |                  |   |
|   [read-only]       |   Read-only: true                    | |   [Image]        |   |
|                     |   Hints: "Useful for data queries"   | |                  |   |
| ( ) echo            |                                      | +------------------+   |
| ( ) add             | table *                              |                        |
| ( ) longOp          | +--------------------------------+   | {                      |
|   [long-run]        | | users                        v |   |   "rows": 42,          |
| ( ) dangerOp        | +--------------------------------+   |   "data": [...]        |
|   [destructive]     |   Suggestions: users, orders, items  | }                      |
|                     |                                      |                        |
|                     | limit                                | [Play Audio]           |
|                     | +--------------------------------+   |                        |
|                     | | 100                            |   | [Copy] [Clear]         |
|                     | +--------------------------------+   |                        |
|                     |                                      |                        |
|                     | ████████████░░░░░░░░ 60%             |                        |
|                     | Processing step 3 of 5...            |                        |
|                     |                                      |                        |
|                     | [Execute Tool]           [Cancel]    |                        |
+---------------------+--------------------------------------+------------------------+
```

**With Pending Client Requests (inline expansion):**

When a tool execution triggers sampling or elicitation requests, they appear inline:

```
+---------------------+--------------------------------------------------------------+
| Tools (4)           | Tool: query_database                         [Executing...] |
|                     +--------------------------------------------------------------+
| [Search...]         | Parameters: { "table": "users", "limit": 10 }                |
|                     +--------------------------------------------------------------+
| (*) query_db        | [!] Pending Client Requests (2)                              |
| ( ) echo            |                                                              |
| ( ) add             | +----------------------------------------------------------+ |
| ( ) longOp          | | sampling/createMessage                       [1 of 2]   | |
|                     | | Model hints: claude-3-sonnet                            | |
|                     | | Messages: "Analyze this database schema..."             | |
|                     | |                                                          | |
|                     | | Response:  [Testing Profile: Quick Mock]                | |
|                     | | +------------------------------------------------------+ | |
|                     | | | This is a mock LLM response for testing purposes.   | | |
|                     | | +------------------------------------------------------+ | |
|                     | |                                                          | |
|                     | |          [Auto-respond]  [Edit & Send]  [Reject]        | |
|                     | +----------------------------------------------------------+ |
|                     |                                                              |
|                     | +----------------------------------------------------------+ |
|                     | | elicitation/create (form)                    [2 of 2]   | |
|                     | | Message: "Please confirm the query parameters"          | |
|                     | |                                                          | |
|                     | | table: [users     ]  limit: [10]  [x] include_deleted   | |
|                     | |                                                          | |
|                     | |                                [Cancel]  [Submit]       | |
|                     | +----------------------------------------------------------+ |
|                     |                                                              |
|                     |                                            [Cancel Tool]     |
+---------------------+--------------------------------------------------------------+
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

## Resources Screen

Uses an **accordion layout** for the left panel to organize Resources, Templates, and Subscriptions into collapsible sections.

```
+--------------------------------+--------------------------------------------+
| Resources                      | Content Preview (65%)                      |
| [*] List updated [Refresh Now] |                                            |
+--------------------------------+--------------------------------------------+
|                                |                                            |
| [Search...]                    | URI: file:///config.json                   |
|                                | MIME: application/json                     |
| [v] Resources (12)             | -----------------------------              |
| +-----------------------------+|                                            |
| | (*) config.json             || Annotations:                               |
| |   [application]             ||   Audience: application                    |
| |   [priority: 0.9]           ||   Priority: 0.9 (high)                     |
| |                             ||                                            |
| | ( ) readme.md               || {                                          |
| |   [user]                    ||   "name": "my-app",                        |
| |                             ||   "version": "1.0.0"                       |
| | ( ) data.csv                || }                                          |
| | ( ) schema.json             ||                                            |
| |   ... (8 more)              || [Copy] [Subscribe] [Unsubscribe]           |
| +-----------------------------+|                                            |
|                                | Last updated: 14:32:05                     |
| [>] Templates (2)              |                                            |
|                                |                                            |
| [>] Subscriptions (1)          |                                            |
|                                |                                            |
+--------------------------------+--------------------------------------------+
```

**Expanded Templates Section:**
```
| [v] Templates (2)              |
| +-----------------------------+|
| | ( ) user/{id}               ||
| |   [id: ________ ] [Go]      ||
| |                             ||
| | ( ) file/{path}             ||
| |   [path: _______ ] [Go]     ||
| +-----------------------------+|
```

**Expanded Subscriptions Section:**
```
| [v] Subscriptions (1)          |
| +-----------------------------+|
| | (*) config.json             ||
| |   Last update: 14:32:05     ||
| |                  [Unsub]    ||
| +-----------------------------+|
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

## Prompts Screen

```
+------------------------------+----------------------------------------------+
| Prompts (2)                  | Result (65%)                                 |
| [*] List updated [Refresh]   |                                              |
+------------------------------+----------------------------------------------+
|                              |                                              |
| Select Prompt:               | Messages:                                    |
| +--------------------------+ |                                              |
| | greeting_prompt        v | | [0] role: user                               |
| +--------------------------+ |     Content:                                 |
|                              |     "Hello, my name is John and I            |
| Description:                 |      like cats"                              |
| "Generates a friendly        |                                              |
|  greeting message"           |     [Image: profile.png]                     |
|                              |                                              |
| Arguments:                   | [1] role: assistant                          |
| -------------                |     "Nice to meet you, John! I see           |
|                              |      you're a cat lover..."                  |
| name *                       |                                              |
| +--------------------------+ |                                              |
| | John                   v | |                                              |
| +--------------------------+ |                                              |
|   Suggestions: John, Jane    |                                              |
|                              |                                              |
| interests                    |                                              |
| +--------------------------+ |                                              |
| | cats                     | |                                              |
| +--------------------------+ |                                              |
|                              |                                              |
| [Get Prompt]                 | [Copy JSON] [Copy Messages]                  |
+------------------------------+----------------------------------------------+
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

## Logging Screen

```
+-----------------------+-----------------------------------------------------+
| Log Controls (25%)    | Log Stream (75%)                                    |
| <-> resize            |                                                     |
+-----------------------+-----------------------------------------------------+
|                       |                                                     |
| Log Level:            | 14:32:01 [INFO]     Server initialized              |
| +-----------------+   | 14:32:02 [DEBUG]    Loading tool: echo              |
| | debug         v |   | 14:32:02 [DEBUG]    Loading tool: add               |
| +-----------------+   | 14:32:03 [NOTICE]   Configuration loaded            |
|                       | 14:32:05 [WARNING]  Rate limit approaching          |
| [Set Level]           | 14:32:10 [ERROR]    Failed to fetch resource: 404   |
|                       | 14:32:15 [CRITICAL] Database connection lost        |
| Filter:               | 14:32:16 [ALERT]    Service degraded                |
| +-----------------+   | 14:32:20 [EMERGENCY] System failure                 |
| |                 |   |                                                     |
| +-----------------+   | -------------------------------------------------   |
|                       |                                                     |
| Show Levels:          |                                                     |
| [x] DEBUG             |                                                     |
| [x] INFO              |                                                     |
| [x] NOTICE            |                                                     |
| [x] WARNING           |                                                     |
| [x] ERROR             |                                                     |
| [x] CRITICAL          |                                                     |
| [x] ALERT             |                                                     |
| [x] EMERGENCY         |                                                     |
|                       |                                                     |
| Request Filter:       |                                                     |
| +-----------------+   |                                                     |
| | All requests  v |   |                                                     |
| +-----------------+   |                                                     |
|                       |                                                     |
| [Clear] [Export]      | [Auto-scroll] [Copy All]                            |
+-----------------------+-----------------------------------------------------+
```

**With Request Correlation:**

Logs can be filtered by the request that triggered them:

```
+-----------------------+-----------------------------------------------------+
| Log Controls (25%)    | Log Stream (filtered by request)                    |
+-----------------------+-----------------------------------------------------+
|                       |                                                     |
| Request Filter:       | Showing logs for: tools/call (query_database)       |
| +-----------------+   |                                   [View in History] |
| | query_database  |   | -------------------------------------------------   |
| |   14:32:10    v |   | 14:32:10 [DEBUG]    Starting query execution        |
| +-----------------+   | 14:32:11 [INFO]     Requesting LLM analysis         |
|                       | 14:32:12 [DEBUG]    Sampling response received      |
| Recent Requests:      | 14:32:13 [WARNING]  Query taking longer than usual  |
| ( ) query_database    | 14:32:15 [INFO]     Query completed, 42 rows        |
| ( ) analyze_data      |                                                     |
| ( ) prompts/get       |                                                     |
|                       |                                                     |
| [Show All Logs]       | [Auto-scroll] [Copy Filtered]                       |
+-----------------------+-----------------------------------------------------+
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
- **Request Correlation**:
  - Filter logs by request (shows logs emitted during a specific tool/resource/prompt call)
  - Recent requests dropdown shows last N requests
  - [View in History] link navigates to the request in History screen
  - Logs include correlation ID linking them to their parent request
  - Click any log entry to see which request chain it belongs to

## Tasks Screen

```
+-------------------------------------------------------------------------+
| Tasks                                                     [Refresh]     |
+-------------------------------------------------------------------------+
|                                                                         |
| Active Tasks (2)                                                        |
| +---------------------------------------------------------------------+ |
| | Task: abc-123              Status: running         ████████░░ 80%   | |
| | Method: tools/call                                                  | |
| | Tool: longRunningOperation                                          | |
| | Started: 14:32:05          Elapsed: 45s                             | |
| | Progress: Processing batch 4 of 5...                                | |
| |                                            [View Details] [Cancel]  | |
| +---------------------------------------------------------------------+ |
|                                                                         |
| +---------------------------------------------------------------------+ |
| | Task: def-456              Status: waiting         ░░░░░░░░░░ 0%    | |
| | Method: resources/read                                              | |
| | Resource: large-dataset                                             | |
| | Started: 14:33:00          Elapsed: 10s                             | |
| |                                            [View Details] [Cancel]  | |
| +---------------------------------------------------------------------+ |
|                                                                         |
| Completed Tasks (3)                                    [Clear History]  |
| +---------------------------------------------------------------------+ |
| | Task: ghi-789              Status: completed       ██████████ 100%  | |
| | Method: tools/call (processData)                                    | |
| | Completed: 14:31:30        Duration: 1m 30s                         | |
| |                                            [View Result] [Dismiss]  | |
| +---------------------------------------------------------------------+ |
|                                                                         |
+-------------------------------------------------------------------------+
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

## History Screen

A unified history of all MCP requests with **hierarchical request trace** capability. Shows parent-child relationships when tool calls trigger sampling or elicitation requests.

```
+-------------------------------------------------------------------------------------+
| History                                           [Search...] [Filter v] [Clear All] |
+-------------------------------------------------------------------------------------+
|                                                                                     |
| [>] 14:35:22  tools/call  query_database         [success] 450ms   [Replay] [Pin]   |
|     +-- 14:35:23  sampling/createMessage  claude-3-sonnet           [+45ms]         |
|     |     Model: claude-3-sonnet-20241022                                           |
|     |     Response: "Based on the schema, I recommend..."         [Expand]          |
|     +-- 14:35:24  sampling/createMessage  gpt-4                     [+120ms]        |
|     |     Model: gpt-4-turbo                                                        |
|     |     Response: "The query should use an index..."            [Expand]          |
|     +-- 14:35:25  elicitation/create  (form: confirm_action)        [+200ms]        |
|           User provided: { confirmed: true }                                        |
|                                                                                     |
| [>] 14:34:15  resources/read  file:///config.json  [success] 120ms  [Replay] [Pin]  |
|     (no client requests)                                                            |
|                                                                                     |
| [>] 14:33:45  prompts/get  greeting_prompt        [success] 30ms   [Replay] [Pin]   |
|     Arguments: { "name": "John", "interests": "cats" }                              |
|                                                                                     |
| [>] 14:32:10  tools/call  analyze_data            [success] 800ms  [Replay] [Pin]   |
|     +-- 14:32:11  sampling/createMessage  claude-3-opus             [+350ms]        |
|     |     Messages: "Analyze this dataset and identify..."                          |
|     |     Response: "I've identified 3 key patterns..."          [Expand]           |
|     +-- 14:32:12  elicitation/create  (url: oauth)                  [+400ms]        |
|           Status: User completed OAuth flow                                         |
|                                                                                     |
| Pinned Requests (2)                                                                 |
| +---------------------------------------------------------------------------------+ |
| | * "Test query"     tools/call  query_database    14:35:22      [Replay] [Unpin]  | |
| | * "Get config"     resources/read  config.json   14:34:15      [Replay] [Unpin]  | |
| +---------------------------------------------------------------------------------+ |
|                                                                                     |
|                                                          Showing 50 of 127 entries |
|                                                               [Load More]          |
+-------------------------------------------------------------------------------------+
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
