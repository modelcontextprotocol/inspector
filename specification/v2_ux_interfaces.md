# Inspector V2 UX - Component Interfaces

### [Brief](README.md) | [V1 Problems](v1_problems.md) | [V2 Scope](v2_scope.md) | [V2 Tech Stack](v2_web_client.md) | V2 UX
#### [Overview](v2_ux.md) | [Features](v2_ux_features.md) | [Handlers](v2_ux_handlers.md) | [Screenshots](v2_screenshots.md) | [Components](v2_ux_components.md) | Interfaces

## Summary

The Inspector V2 web client's React components were created iteratively from text
descriptions, ASCII wireframes, mockup screenshots, and hand-tweaked refinements.
Their current prop interfaces were derived from those informal sources plus
intuitive gap-filling during implementation. As a result, the component layer is
visually polished and internally consistent, but the data shapes it consumes are
ad hoc — they do not yet line up with the authoritative object definitions that
the Inspector core will actually hand down at runtime.

Those authoritative object definitions come from the Model Context Protocol
schema (see
[modelcontextprotocol/schema 2025-11-25](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2025-11-25/schema.json)).
Tools, Prompts, Resources, ResourceTemplates, Messages, ServerCapabilities, Roots,
LoggingMessage notifications, ProgressNotifications, ElicitRequests,
CreateMessageRequests (sampling), and every other MCP primitive our UI surfaces
has a canonical shape in that schema. Wherever a component currently accepts a
local, inferred type for one of those primitives, it must instead accept the
corresponding MCP schema type (or an explicit superset/wrapper type defined in
`core/`).

In addition to MCP schema objects, components receive two other categories of
props:

1. **Callbacks** — handlers invoked when the user interacts with the UI
   (connect, disconnect, callTool, readResource, subscribe, setLogLevel, respond
   to elicitation, approve sampling, etc.). These are provided by the Inspector
   core's hook layer and passed down as props.
2. **Application state** — UI-facing state that is not part of the MCP schema
   but is needed to render correctly: connection status, pending request lists,
   history entries, selection state, loading flags, error strings, form drafts,
   etc. Shapes for these are owned by the web client, but where they wrap MCP
   objects, they should embed the schema types verbatim rather than
   re-declaring them.

### Dumb component principle

Every component in `clients/web/src/components/` is a **dumb component**. It:

- Renders the data passed in via props.
- Executes the callbacks passed in via props in response to user interaction.
- Holds internal state *only* where needed for presentation or local
  interaction (open/closed accordions, text in an uncommitted form field,
  current tab index, hover state, etc.).
- Does **not** fetch data, manage MCP transport, persist anything to storage,
  or know about global application state.

All communication with MCP servers, transport lifecycle management, request
correlation, history recording, log buffering, subscription tracking, and
persistence is owned by the **Inspector core system**. The core lives in this
repo under `core/` and is modeled after the v1.5 architecture — specifically the
React hooks published on the
[v1.5/main branch of modelcontextprotocol/inspector](https://github.com/modelcontextprotocol/inspector/tree/v1.5/main).
Those hooks (`useConnection`, `useInspectorClient`, `useServerCapabilities`, etc.)
produce the exact data and callbacks that the upper-layer screen/view
components will destructure and pass down into the component tree as props.

### Goals of this plan

1. **Inventory** every component currently under
   `clients/web/src/components/` grouped by its folder (`elements/`, `groups/`,
   `screens/`, `views/`).
2. **Identify MCP schema touch points** — for each component, list the MCP
   schema types its props should reference.
3. **Propose a new prop interface** — for each component, document the current
   props, the target props (schema types + callbacks + app state), and any
   internal display/logic refactors that will be required to consume the new
   shapes.
4. **Map callbacks to core hooks** — note which Inspector core hook is expected
   to provide each callback and each piece of application state, so the
   wiring layer (screens and views) has a clear contract to fulfill.

This document is a **plan only**. No component code is modified by producing
it. Implementation will happen in follow-up PRs, one component family at a
time, with Storybook stories updated in lockstep so each component can be
exercised in isolation against realistic MCP schema fixtures.

### Document conventions

For each component, the plan records:

- **Location** — folder path under `clients/web/src/components/`.
- **Purpose** — one-line description of what the component renders.
- **Current props** — the interface as it exists today.
- **MCP schema touch points** — which MCP types the props should align to.
- **Target props** — the proposed new interface.
- **Callbacks → core hook** — which Inspector core hook supplies each callback.
- **Internal refactors** — display/logic changes implied by the new shape.

---

## Audit results (Phase 5 close-out, 2026-04-26)

After Phases 0–5 of [`v2_ux_interfaces_plan.md`](v2_ux_interfaces_plan.md), the
component layer was audited against this spec by reading every component file
under `clients/web/src/components/` and comparing its exported props interface
and internal rendering against the corresponding entry's **Target props** and
**Internal refactors** here. Spec entries that reference `Inspector*`
placeholder names map to v1.5 actual names per the plan's
"Name-mapping correction" table — components using those v1.5 names
(`MCPServerConfig`, `ServerType`, `Task`, `MessageEntry`, etc.) are treated
as satisfied.

**Result: 57 of 62 satisfied, 5 partial, 0 unstarted.**

### Partials still open

- **ElicitationUrlPanel** — accepts scalar `message` / `url` / `requestId`
  props. Spec target wraps these in `InspectorUrlElicitRequest`. **Blocked
  on the v2 core hook layer effort** — the wrapper type was deferred from
  Phase 0.2 and was not added to `core/mcp/types.ts` because URL-mode
  elicitation has no dedicated handler in this repo yet.
- **InlineElicitationRequest** — accepts only `ElicitRequest['params']`
  (form variant). Spec target is a discriminated union over
  `ElicitRequest | InspectorUrlElicitRequest`. **Same blocker as above.**
- **InlineSamplingRequest** — exposes a flat `responseText: string` prop.
  Spec target is `draftResult?: CreateMessageResult`. In-scope to fix
  without the hook layer; deferred to a follow-up because the inline card's
  draft-editing UX is co-evolving with `SamplingRequestPanel`.
- **ExperimentalFeaturesPanel** — accepts a local
  `clientToggles: ClientExperimentalToggle[]` prop. Spec target is the
  freeform `clientExperimental: ClientCapabilities['experimental']` record
  iterated in-component. The local-toggle shape was retained because the
  panel needs per-toggle metadata (label, description) that the bare
  capabilities record doesn't carry; reconciling the two shapes is a
  follow-up.
- **ResourceListItem** — props match the target shape, but the entry's
  internal-refactor bullet ("Actually render the annotations currently
  received but unused") is unimplemented; the component still ignores
  `resource.annotations`.

The component contracts produced by this refactor are the input spec for
the upcoming v2 `core/` hook layer effort. The two blocked partials above
will close out as part of that work.

---

## Section 1 — Elements (`clients/web/src/components/elements/`)

> Small, focused presentational primitives. Each renders a single MCP concept
> (a badge, an indicator, a button, a viewer) and is composed by higher-level
> group and screen components.

<!-- AGENT:ELEMENTS -->

### AnnotationBadge

- **Location** — `elements/AnnotationBadge/AnnotationBadge.tsx`
- **Purpose** — Single colored badge representing one MCP annotation facet (audience, readOnly, destructive, longRun, priority).
- **Current props** — `label: string`; `variant?: "audience" | "readOnly" | "destructive" | "longRun" | "priority" | "default"`.
- **MCP schema touch points** — `Annotations` object (used by `Tool.annotations` as `ToolAnnotations`, and by `Resource`/`ResourceTemplate`/content blocks). Relevant fields: `audience`, `priority`, and `ToolAnnotations.readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint`.
- **Target props** — `facet: "audience" | "priority" | "readOnlyHint" | "destructiveHint" | "idempotentHint" | "openWorldHint" | "longRunHint"`; `value: Role[] | number | boolean`. Keeps the badge a pure mapping from one annotation facet+value to a styled label; the owning group component (e.g. `ToolCard`) destructures an `Annotations`/`ToolAnnotations` object and renders one `AnnotationBadge` per populated field.
- **Callbacks → core hook** — None.
- **Internal refactors** — Move the facet→label formatting (e.g. `"audience: user, assistant"`, `"priority: 0.8"`, `"read-only"`) into the component so callers only pass the raw schema value. Drop the standalone `label` prop.

### CapabilityItem

- **Location** — `elements/CapabilityItem/CapabilityItem.tsx`
- **Purpose** — Single row in a server-capabilities list: check/cross icon plus capability name and optional count.
- **Current props** — `name: string`; `supported: boolean`; `count?: number`.
- **MCP schema touch points** — `ServerCapabilities` (keys `tools`, `resources`, `prompts`, `logging`, `completions`, `experimental`) plus the paginated `ListToolsResult` / `ListResourcesResult` / `ListPromptsResult` for the count.
- **Target props** — Shape stays similar, but semantics pin `name` to a `keyof ServerCapabilities` and `count` to the length of the corresponding list result. Proposed: `capability: keyof ServerCapabilities`; `supported: boolean`; `count?: number`.
- **Callbacks → core hook** — None. `supported` is derived from `useServerCapabilities` in the wiring layer; `count` from `useInspectorClient` list results.
- **Internal refactors** — Map `capability` key to its display label inside the component (`tools → "Tools"`, etc.).

### ConnectionToggle

- **Location** — `elements/ConnectionToggle/ConnectionToggle.tsx`
- **Purpose** — Large on/off switch that connects or disconnects a configured server.
- **Current props** — `checked: boolean`; `loading: boolean`; `disabled: boolean`; `onChange: (checked: boolean) => void`.
- **MCP schema touch points** — None — purely presentational, but `checked`/`loading` are derived from `ConnectionStatus` application state (not MCP schema).
- **Target props** — `status: ConnectionStatus` (core-owned enum: `"disconnected" | "connecting" | "connected" | "error"`); `disabled?: boolean`; `onToggle: () => void`.
- **Callbacks → core hook** — `onToggle` → wiring layer reads the current `connection.status` for the owning server and dispatches `useConnection`'s `connect` or `disconnect` (v1.5 `useConnection` exposes both).
- **Internal refactors** — Derive `checked`/`loading` from `status` internally; collapse `onChange(boolean)` to a single `onToggle()` — the wiring layer already has the connection state and decides connect vs disconnect, so a boolean from the toggle adds no information.

### ContentViewer

- **Location** — `elements/ContentViewer/ContentViewer.tsx`
- **Purpose** — Renders a single content block (text, JSON-formatted text, image, or audio) with an optional copy overlay.
- **Current props** — `type: "text" | "json" | "image" | "audio"`; `content: string`; `mimeType?: string`; `copyable?: boolean`.
- **MCP schema touch points** — `ContentBlock` union: `TextContent`, `ImageContent`, `AudioContent`, `EmbeddedResource`, `ResourceLink`. Also `BlobResourceContents` / `TextResourceContents` for embedded resources.
- **Target props** — `block: ContentBlock`; `copyable?: boolean`. The component discriminates on `block.type` (`"text" | "image" | "audio" | "resource" | "resource_link"`) and reads `text`, `data` + `mimeType`, or nested `resource` fields from the schema object directly.
- **Callbacks → core hook** — None.
- **Internal refactors** — Replace the ad hoc `"json"` pseudo-type with a heuristic (or explicit flag) applied to `TextContent.text` whose `mimeType` is `application/json`. Add a branch for `EmbeddedResource` and `ResourceLink`. Drop the separate `content`/`mimeType` scalar props.

### CopyButton

- **Location** — `elements/CopyButton/CopyButton.tsx`
- **Purpose** — Thin wrapper around Mantine `CopyButton` + `ActionIcon` that copies a string to the clipboard with a tooltip.
- **Current props** — `value: string`.
- **MCP schema touch points** — None — purely presentational.
- **Target props** — Unchanged: `value: string`.
- **Callbacks → core hook** — None.
- **Internal refactors** — None.

### InlineError

- **Location** — `elements/InlineError/InlineError.tsx`
- **Purpose** — Red alert with a message, optional expandable details, retry counter, and doc link.
- **Current props** — `message: string`; `details?: string`; `retryCount?: number`; `maxRetries?: number`; `docLink?: string`.
- **MCP schema touch points** — `JSONRPCError.error` (`code: number`, `message: string`, `data?: unknown`) is the canonical MCP error shape; any tool result with `isError: true` also surfaces here via its embedded `TextContent`.
- **Target props** — `error: JSONRPCError["error"] | { message: string; data?: unknown }`; `retryCount?: number`; `maxRetries?: number`; `docLink?: string`.
- **Callbacks → core hook** — None. Retry counters come from `useConnection` / request-layer state in the wiring layer.
- **Internal refactors** — Derive `message` from `error.message` and `details` from a pretty-printed `error.data` (or `error.code`) instead of taking them as separate scalar props.

### ListChangedIndicator

- **Location** — `elements/ListChangedIndicator/ListChangedIndicator.tsx`
- **Purpose** — "List updated" pill with a dot and Refresh button, shown when the server emits a list-changed notification.
- **Current props** — `visible: boolean`; `onRefresh: () => void`.
- **MCP schema touch points** — `ToolListChangedNotification`, `ResourceListChangedNotification`, `PromptListChangedNotification`, `RootsListChangedNotification` — all parameterless notifications; the component only needs a boolean "one or more are pending" signal.
- **Target props** — Unchanged: `visible: boolean`; `onRefresh: () => void`.
- **Callbacks → core hook** — `onRefresh` → `useInspectorClient` (re-invokes `listTools` / `listResources` / `listPrompts` / `listRoots` depending on the screen). `visible` comes from core notification-tracking state.
- **Internal refactors** — None.

### ListToggle

- **Location** — `elements/ListToggle/ListToggle.tsx`
- **Purpose** — Icon button that toggles a list between compact and expanded rendering.
- **Current props** — `compact: boolean`; `onToggle: () => void`.
- **MCP schema touch points** — None — purely presentational UI state.
- **Target props** — Unchanged.
- **Callbacks → core hook** — None. `compact` is local UI state held by the owning screen/group.
- **Internal refactors** — None.

### LogEntry

- **Location** — `elements/LogEntry/LogEntry.tsx`
- **Purpose** — Single row in the log stream: timestamp, level badge, optional logger name, message.
- **Current props** — `timestamp: string`; `level: LogLevel`; `message: string`; `logger?: string`.
- **MCP schema touch points** — `LoggingMessageNotification.params` (`level: LoggingLevel`, `logger?: string`, `data: unknown`). Timestamp is not part of the MCP notification — it is recorded by core when the notification arrives.
- **Target props** — `entry: { receivedAt: Date; params: LoggingMessageNotification["params"] }` — a core-owned wrapper type that embeds the MCP params verbatim and adds the client-side receive time (`Date`, matching v1.5's `MessageEntry`/`StderrLogEntry` convention).
- **Callbacks → core hook** — None. Log buffer is owned by core (`useLoggingNotifications` or equivalent) and entries are passed down as props.
- **Internal refactors** — Accept `params.data` (`unknown`) and render it via a string coercion / JSON stringify instead of a pre-formatted `message`. Pull `level` and `logger` off `params`. Remove the local `LogLevel` alias in favor of the schema's `LoggingLevel`.

### LogLevelBadge

- **Location** — `elements/LogLevelBadge/LogLevelBadge.tsx`
- **Purpose** — Colored badge for a single MCP log level.
- **Current props** — `level: LogLevel` (local union re-exported from `LogEntry`).
- **MCP schema touch points** — `LoggingLevel` (`"debug" | "info" | "notice" | "warning" | "error" | "critical" | "alert" | "emergency"`).
- **Target props** — `level: LoggingLevel` (imported from the MCP schema types in `core/`).
- **Callbacks → core hook** — None.
- **Internal refactors** — Swap the local `LogLevel` import for the schema `LoggingLevel` type. No visual changes.

### MessageBubble

- **Location** — `elements/MessageBubble/MessageBubble.tsx`
- **Purpose** — One message in a sampling `CreateMessageRequest` preview or assistant/user transcript, with text and optional image/audio content.
- **Current props** — `index: number`; `role: "user" | "assistant"`; `content: string`; `imageContent?: { data: string; mimeType: string }`; `audioContent?: { data: string; mimeType: string }`.
- **MCP schema touch points** — `SamplingMessage` (`role: Role`, `content: TextContent | ImageContent | AudioContent`). Also `PromptMessage` for prompt rendering, which uses `ContentBlock`.
- **Target props** — `index: number`; `message: SamplingMessage` (or `PromptMessage` when used in the prompts screen — both share the `role` + content-block shape).
- **Callbacks → core hook** — None.
- **Internal refactors** — Discriminate on `message.content.type` instead of taking three parallel content props. Delegate content rendering to `ContentViewer` for consistency.

### ProgressDisplay

- **Location** — `elements/ProgressDisplay/ProgressDisplay.tsx`
- **Purpose** — Progress bar with an optional description and elapsed-time caption.
- **Current props** — `progress: number` (0–100); `description?: string`; `elapsed?: string`.
- **MCP schema touch points** — `ProgressNotification.params` (`progressToken`, `progress: number`, `total?: number`, `message?: string`).
- **Target props** — `params: ProgressNotification["params"]`; `elapsed?: string` (client-computed from the time the request was issued).
- **Callbacks → core hook** — None. Progress state is aggregated by core (`useInspectorClient` / request tracker) keyed by `progressToken`.
- **Internal refactors** — Compute the displayed percentage from `progress`/`total` (fall back to raw `progress` if `total` is missing). Read caption text from `message` instead of `description`.

### ServerStatusIndicator

- **Location** — `elements/ServerStatusIndicator/ServerStatusIndicator.tsx`
- **Purpose** — Colored dot + text label showing current connection state for a server, with optional latency and retry count.
- **Current props** — `status: "connected" | "connecting" | "disconnected" | "failed"`; `latencyMs?: number`; `retryCount?: number`.
- **MCP schema touch points** — None — purely application state. (Server identity lives in `Implementation`, but the indicator itself only reflects transport status.)
- **Target props** — `status: ConnectionStatus` (core-owned enum matching the four states above); `latencyMs?: number`; `retryCount?: number`.
- **Callbacks → core hook** — None. All three props come from `useConnection`.
- **Internal refactors** — None beyond importing `ConnectionStatus` from `core/` once defined.

### SubscribeButton

- **Location** — `elements/SubscribeButton/SubscribeButton.tsx`
- **Purpose** — Toggle button to subscribe/unsubscribe from a single MCP resource.
- **Current props** — `subscribed: boolean`; `onToggle: () => void`.
- **MCP schema touch points** — `SubscribeRequest.params.uri` and `UnsubscribeRequest.params.uri` — but the URI is held by the parent row; the button itself only needs the current subscription boolean.
- **Target props** — `subscribed: boolean`; `onToggle: () => void`. (`ConnectionToggle` settled on the same single-callback shape; the wiring layer reads `subscribed` and dispatches subscribe vs unsubscribe.)
- **Callbacks → core hook** — `onToggle` → wiring layer dispatches `useInspectorClient`'s `client.subscribeResource` or `client.unsubscribeResource` based on the current `subscribed` value; `subscribed` derived from a core-owned subscription set.
- **Internal refactors** — None.

### TaskStatusBadge

- **Location** — `elements/TaskStatusBadge/TaskStatusBadge.tsx`
- **Purpose** — Colored badge for the current lifecycle state of a long-running task.
- **Current props** — `status: TaskStatus` (imported from `groups/TaskCard/TaskCard`: `"waiting" | "running" | "completed" | "failed" | "cancelled"`).
- **MCP schema touch points** — The 2025-11-25 MCP schema does not define a first-class "task" primitive; task state is an Inspector-side aggregation over in-flight requests, cancellations (`CancelledNotification`), progress (`ProgressNotification`), and final results/errors. So the type is core-owned application state, not schema.
- **Target props** — `status: TaskStatus` where `TaskStatus` is moved out of `TaskCard` into a core-owned type (e.g. `core/src/tasks/types.ts`) so both this badge and `TaskCard` import it from the same place.
- **Callbacks → core hook** — None. Status comes from a core task-tracking hook (e.g. `useTasks`) in the wiring layer.
- **Internal refactors** — Update the import path for `TaskStatus` to the core module; no visual changes.

### TransportBadge

- **Location** — `elements/TransportBadge/TransportBadge.tsx`
- **Purpose** — Small outline badge labeling a server's transport (`STDIO` or `HTTP`).
- **Current props** — `transport: "stdio" | "http"`.
- **MCP schema touch points** — None — transport is not in the MCP wire schema; it is described by core-owned server-config types (stdio command/args vs. streamable HTTP URL, matching v1.5's `StdioServerParameters` and streamable-HTTP transport options).
- **Target props** — `transport: TransportKind` where `TransportKind = "stdio" | "streamable-http" | "sse"` is owned by `core/` (aligning with v1.5's supported transports).
- **Callbacks → core hook** — None. Value comes from the server-config record exposed by the wiring layer.
- **Internal refactors** — Extend the display-label map to cover `streamable-http` (e.g. `"HTTP"`) and `sse` (e.g. `"SSE"`) so the badge can render every transport core supports.

<!-- /AGENT:ELEMENTS -->

---

## Section 2 — Groups (`clients/web/src/components/groups/`)

> Composite components that combine elements into a functional panel, form,
> list item, or control cluster. Most of the MCP-schema-shaped data flows
> through this layer.

<!-- AGENT:GROUPS -->

### ElicitationFormPanel

- **Location**: `groups/ElicitationFormPanel/`
- **Purpose**: Full-panel form rendering an `elicitation/create` request with schema-driven fields, trust warning, and submit/cancel actions.
- **Current props**: `message`, `schema: JsonSchema`, `values`, `serverName`, `onChange`, `onSubmit`, `onCancel`.
- **MCP schema touch points**: `ElicitRequest.params` (`message`, `requestedSchema`), `PrimitiveSchemaDefinition`, `ElicitResult` (`action`, `content`).
- **Target props**: `request: ElicitRequest` (or `{ message; requestedSchema }`), `serverName: string`, `values: Record<string, PrimitiveValue>`, `onChange`, `onSubmit(result: ElicitResult)`, `onCancel()`.
- **Callbacks → core hook**: `onSubmit`/`onCancel` from the pending-elicitation queue (handled inside `InspectorClient`; v2 pending-queue hook TBD) (pending `ElicitRequest` queue).
- **Internal refactors**: Constrain to `PrimitiveSchemaDefinition` record instead of freeform `JsonSchema`; emit `{action:'accept'|'decline'|'cancel', content}`.

### ElicitationUrlPanel

- **Location**: `groups/ElicitationUrlPanel/`
- **Purpose**: Full-panel display of a URL-mode elicitation (copy URL, open externally, wait for completion).
- **Current props**: `message`, `url`, `elicitationId`, `isWaiting`, `onCopyUrl`, `onOpenInBrowser`, `onCancel`.
- **MCP schema touch points**: URL-mode elicitation is NOT in MCP 2025-11-25 — Inspector-owned extension of `ElicitRequest`.
- **Target props**: `request: InspectorUrlElicitRequest` (`requestId`, `message`, `url`), `isWaiting`, `onCopyUrl`, `onOpenInBrowser`, `onCancel`.
- **Callbacks → core hook**: the pending-elicitation queue (handled inside `InspectorClient`; v2 pending-queue hook TBD) (URL variant).
- **Internal refactors**: Replace scalar props with wrapper object.

### ExperimentalFeaturesPanel

- **Location**: `groups/ExperimentalFeaturesPanel/`
- **Purpose**: Displays server/client experimental capabilities and a raw JSON-RPC tester with headers and request history.
- **Current props**: `serverCapabilities`, `clientCapabilities`, `requestJson`, `responseJson`, `customHeaders`, `requestHistory`, many handlers.
- **MCP schema touch points**: `ServerCapabilities.experimental`, `ClientCapabilities.experimental` (freeform `{[k]: object}`); `JSONRPCRequest`/`JSONRPCResponse`/`JSONRPCError`. `RequestHistoryItem` is Inspector-owned.
- **Target props**: `serverExperimental: ServerCapabilities['experimental']`, `clientExperimental: ClientCapabilities['experimental']`, `requestDraft: string`, `response?: JSONRPCResponse | JSONRPCError`, `customHeaders: HeaderPair[]`, `history: InspectorRequestHistoryItem[]`, handlers unchanged.
- **Callbacks → core hook**: `onSendRequest`/`onTestCapability` from `useInspectorClient`; `onToggleClientCapability` from `useClientCapabilities` (v2-only — no v1.5 analog); history from `useHistory`.
- **Internal refactors**: Iterate over the freeform capability record rather than an inferred `{name,description,methods}` list.

### HistoryControls

- **Location**: `groups/HistoryControls/`
- **Purpose**: Search + method filter sidebar for the history screen.
- **Current props**: `searchText`, `methodFilter`, `onSearchChange`, `onMethodFilterChange`.
- **MCP schema touch points**: Method filter values are MCP `Request.method` literals.
- **Target props**: `searchText`, `methodFilter?: RequestMethod`, `availableMethods: RequestMethod[]`, `onSearchChange`, `onMethodFilterChange`.
- **Callbacks → core hook**: `useMessageLog`.
- **Internal refactors**: Type the method filter as a union of MCP method strings.

### HistoryEntry

- **Location**: `groups/HistoryEntry/`
- **Purpose**: Collapsible card for a single historical MCP request/response with replay and pin.
- **Current props**: `timestamp`, `method`, `target?`, `status`, `durationMs`, `parameters`, `response`, `childEntries`, `isPinned`, `isListExpanded`, `onReplay`, `onTogglePin`.
- **MCP schema touch points**: Wraps an MCP `Request`/`Result` pair; parameters → `Request.params`, response → `Result | JSONRPCError`. Child entries are nested server→client calls (sampling/elicitation/roots).
- **Target props**: `entry: InspectorHistoryEntry` (embeds `request: JSONRPCRequest`, `response?: JSONRPCResponse | JSONRPCError`, `startedAt`, `durationMs`, `childEntries`, `isPinned`), `isListExpanded`, `onReplay`, `onTogglePin`.
- **Callbacks → core hook**: `useMessageLog`.
- **Internal refactors**: Derive `method`/`target`/`status` from the embedded JSON-RPC objects rather than flat scalars.

### HistoryListPanel

- **Location**: `groups/HistoryListPanel/`
- **Purpose**: Scrollable list of pinned + regular history entries with toolbar.
- **Current props**: `entries`, `pinnedEntries`, `searchText`, `methodFilter?`, `onClearAll`, `onExport`.
- **MCP schema touch points**: Same `InspectorHistoryEntry` wrapper as above.
- **Target props**: `entries: InspectorHistoryEntry[]`, `pinnedEntries: InspectorHistoryEntry[]`, `searchText`, `methodFilter?`, `onClearAll`, `onExport`, `onReplay(entryId)`, `onTogglePin(entryId)`.
- **Callbacks → core hook**: `useMessageLog`.
- **Internal refactors**: Pass entry id + handlers down instead of pre-bound callbacks on each entry.

### ImportServerJsonPanel

- **Location**: `groups/ImportServerJsonPanel/`
- **Purpose**: Form for pasting/validating an MCP registry `server.json` and configuring env vars before adding.
- **Current props**: `jsonContent`, `validationResults`, `packages?`, `selectedPackageIndex`, `envVars`, `serverName`, handlers.
- **MCP schema touch points**: `server.json` is MCP **registry** spec, not the runtime schema — Inspector/registry-owned.
- **Target props**: `draft: InspectorServerJsonDraft` (raw text + parsed `RegistryServerJson` + `selectedPackageIndex` + env overrides + name override), `validation: ValidationResult[]`, handlers unchanged.
- **Callbacks → core hook**: `useServerRegistry` (v2-only — no v1.5 analog) / `useServers`.
- **Internal refactors**: Collapse scattered scalar props into a single draft object.

### InlineElicitationRequest

- **Location**: `groups/InlineElicitationRequest/`
- **Purpose**: Compact inline card for a pending elicitation (form or URL mode) in request queues.
- **Current props**: `mode`, `message`, `queuePosition`, `schema?`, `values?`, `url?`, `isWaiting?`, handlers.
- **MCP schema touch points**: `ElicitRequest` (form); URL variant is Inspector-owned.
- **Target props**: `request: ElicitRequest | InspectorUrlElicitRequest`, `queuePosition`, `values?`, `isWaiting?`, handlers.
- **Callbacks → core hook**: the pending-elicitation queue (handled inside `InspectorClient`; v2 pending-queue hook TBD).
- **Internal refactors**: Discriminate on `request` shape rather than a separate `mode` prop.

### InlineSamplingRequest

- **Location**: `groups/InlineSamplingRequest/`
- **Purpose**: Compact inline card for a pending `sampling/createMessage` request.
- **Current props**: `queuePosition`, `modelHints?`, `messagePreview`, `responseText`, `onAutoRespond`, `onEditAndSend`, `onReject`, `onViewDetails`.
- **MCP schema touch points**: `CreateMessageRequest` (`messages`, `modelPreferences.hints[].name`, etc.), `CreateMessageResult`.
- **Target props**: `request: CreateMessageRequest`, `queuePosition`, `draftResult?: CreateMessageResult`, handlers.
- **Callbacks → core hook**: the pending-sampling queue (handled inside `InspectorClient`; v2 pending-queue hook TBD).
- **Internal refactors**: Derive `modelHints` and `messagePreview` from the embedded request.

### LogControls

- **Location**: `groups/LogControls/`
- **Purpose**: Sidebar for setting active log level, filtering text, and toggling visible levels.
- **Current props**: `currentLevel`, `filterText`, `visibleLevels`, `onSetLevel`, `onFilterChange`, `onToggleLevel`, `onToggleAllLevels`.
- **MCP schema touch points**: `LoggingLevel` union, `SetLevelRequest.params.level`.
- **Target props**: `currentLevel: LoggingLevel`, `filterText`, `visibleLevels: Record<LoggingLevel, boolean>`, handlers typed with `LoggingLevel`.
- **Callbacks → core hook**: `onSetLevel` from `useMessageLog` (issues `logging/setLevel`); visibility is client state from `useLogs` or screen.
- **Internal refactors**: Replace string-typed levels with `LoggingLevel` throughout.

### LogStreamPanel

- **Location**: `groups/LogStreamPanel/`
- **Purpose**: Scrollable stream of log entries with auto-scroll, clear, export, copy-all.
- **Current props**: `entries: LogEntryProps[]`, `filterText`, `visibleLevels`, `autoScroll`, handlers.
- **MCP schema touch points**: `LoggingMessageNotification.params` (`level`, `logger?`, `data`).
- **Target props**: `entries: InspectorLogEntry[]` (wraps `LoggingMessageNotification['params']` + timestamp), `filterText`, `visibleLevels: Record<LoggingLevel, boolean>`, `autoScroll`, handlers.
- **Callbacks → core hook**: `useMessageLog` (buffers `notifications/message`).
- **Internal refactors**: Adapt `LogEntry` to render `LoggingMessageNotification.params` directly.

### PendingClientRequests

- **Location**: `groups/PendingClientRequests/`
- **Purpose**: Alert wrapper showing a pending-request count and rendering children (sampling/elicitation cards).
- **Current props**: `count`, `children`.
- **MCP schema touch points**: None directly; children render `CreateMessageRequest`/`ElicitRequest` inline cards.
- **Target props**: Unchanged; optionally `requests: InspectorPendingRequest[]` if the wrapper needs to render its own list.
- **Callbacks → core hook**: N/A (children own their handlers).
- **Internal refactors**: None.

### PromptArgumentsForm

- **Location**: `groups/PromptArgumentsForm/`
- **Purpose**: Form for filling a prompt's declared arguments before issuing `prompts/get`.
- **Current props**: `name`, `description?`, `arguments`, `argumentValues`, `onArgumentChange`, `onGetPrompt`.
- **MCP schema touch points**: `Prompt`, `PromptArgument` (`name`, `description`, `required`), `GetPromptRequest.params`.
- **Target props**: `prompt: Prompt`, `argumentValues: Record<string, string>`, `onArgumentChange`, `onGetPrompt(args: GetPromptRequest['params']['arguments'])`.
- **Callbacks → core hook**: `onGetPrompt` from `useManagedPrompts`.
- **Internal refactors**: Read `prompt.arguments` directly; display `prompt.title ?? prompt.name`.

### PromptControls

- **Location**: `groups/PromptControls/`
- **Purpose**: Searchable prompts list sidebar with list-changed indicator.
- **Current props**: `prompts: PromptItem[]`, `listChanged`, `onRefreshList`, `onSelectPrompt`.
- **MCP schema touch points**: `Prompt`, `ListPromptsResult`, `PromptListChangedNotification`.
- **Target props**: `prompts: Prompt[]`, `selectedName?: string`, `listChanged`, `onRefreshList()`, `onSelectPrompt(name)`.
- **Callbacks → core hook**: `useManagedPrompts`.
- **Internal refactors**: Replace local `PromptItem` with schema `Prompt`; lift `selected` out of item.

### PromptListItem

- **Location**: `groups/PromptListItem/`
- **Purpose**: Single selectable row in the prompts list.
- **Current props**: `name`, `description?`, `selected`, `onClick`.
- **MCP schema touch points**: `Prompt`.
- **Target props**: `prompt: Prompt`, `selected`, `onClick()`.
- **Callbacks → core hook**: selection via `usePrompts`.
- **Internal refactors**: Render `prompt.title ?? prompt.name` + `description` from the schema object.

### PromptMessagesDisplay

- **Location**: `groups/PromptMessagesDisplay/`
- **Purpose**: Renders the assembled `GetPromptResult` message list as bubbles.
- **Current props**: `messages: PromptMessage[]` (flat `content`/`imageContent`/`audioContent`), `onCopyAll?`.
- **MCP schema touch points**: `GetPromptResult.messages: PromptMessage[]`, where `content` is `TextContent | ImageContent | AudioContent | EmbeddedResource | ResourceLink`.
- **Target props**: `messages: PromptMessage[]` (schema type), `onCopyAll?`.
- **Callbacks → core hook**: `onCopyAll` is UI-local; selected prompt content from `usePrompts`.
- **Internal refactors**: Handle full discriminated union of content blocks; delegate rendering to a content-block element.

### ResourceControls

- **Location**: `groups/ResourceControls/`
- **Purpose**: Accordion sidebar listing resources, templates, and subscriptions with search.
- **Current props**: `resources`, `templates`, `subscriptions`, `listChanged`, `onRefreshList`, `onSelectUri`, `onSelectTemplate`, `onUnsubscribeResource`.
- **MCP schema touch points**: `Resource`, `ResourceTemplate`, `ListResourcesResult`, `ListResourceTemplatesResult`, `ResourceListChangedNotification`, `ResourceUpdatedNotification`.
- **Target props**: `resources: Resource[]`, `templates: ResourceTemplate[]`, `subscriptions: InspectorResourceSubscription[]`, `selectedUri?`, `selectedTemplate?`, `listChanged`, handlers.
- **Callbacks → core hook**: `useManagedResources`.
- **Internal refactors**: Replace inferred item types with schema types; lift `selected` out.

### ResourceListItem

- **Location**: `groups/ResourceListItem/`
- **Purpose**: Single selectable row in the resources or templates list.
- **Current props**: `name`, `uri`, `annotations?`, `selected`, `onClick`.
- **MCP schema touch points**: `Resource` / `ResourceTemplate` with `Annotations` (`audience`, `priority`).
- **Target props**: `resource: Resource | ResourceTemplate`, `selected`, `onClick()`.
- **Callbacks → core hook**: selection via `useResources`.
- **Internal refactors**: Actually render the annotations currently received but unused; use `title ?? name`.

### ResourcePreviewPanel

- **Location**: `groups/ResourcePreviewPanel/`
- **Purpose**: Panel showing content returned by `resources/read` with subscribe/refresh actions.
- **Current props**: `uri`, `mimeType`, `annotations?`, `content: string`, `lastUpdated?`, `isSubscribed`, `onRefresh`, `onSubscribe`, `onUnsubscribe`.
- **MCP schema touch points**: `ReadResourceResult.contents[]` (`TextResourceContents | BlobResourceContents`), parent `Resource`.
- **Target props**: `resource: Resource`, `contents: (TextResourceContents | BlobResourceContents)[]`, `lastUpdated?`, `isSubscribed`, handlers.
- **Callbacks → core hook**: `useManagedResources`.
- **Internal refactors**: Handle blob vs text and iterate over `contents[]` instead of a single string.

### ResourceSubscribedItem

- **Location**: `groups/ResourceSubscribedItem/`
- **Purpose**: Row in subscriptions accordion for a subscribed resource.
- **Current props**: `name`, `lastUpdated?`, `onUnsubscribe`.
- **MCP schema touch points**: `Resource` + Inspector subscription state (`lastUpdated` from `notifications/resources/updated`).
- **Target props**: `subscription: InspectorResourceSubscription` (`{ resource: Resource; lastUpdated? }`), `onUnsubscribe(uri)`.
- **Callbacks → core hook**: `useManagedResources`.
- **Internal refactors**: Take the wrapper, not flat scalars.

### ResourceTemplatePanel

- **Location**: `groups/ResourceTemplatePanel/`
- **Purpose**: Panel expanding a `ResourceTemplate` with per-variable inputs to produce a concrete URI and read it.
- **Current props**: `name`, `title?`, `uriTemplate`, `description?`, `annotations?`, `onReadResource`.
- **MCP schema touch points**: `ResourceTemplate` (`uriTemplate`, `name`, `title`, `description`, `mimeType`, `annotations`).
- **Target props**: `template: ResourceTemplate`, `onReadResource(uri)`.
- **Callbacks → core hook**: `useManagedResources`.
- **Internal refactors**: Destructure a single schema object; keep local variable-values state.

### RootsTable

- **Location**: `groups/RootsTable/`
- **Purpose**: Configures the client-exposed filesystem roots list.
- **Current props**: `roots: RootEntry[]`, `newRootName`, `newRootPath`, handlers.
- **MCP schema touch points**: `Root` (`uri: string (file://...)`, `name?`), `ListRootsResult`, `RootsListChangedNotification`.
- **Target props**: `roots: Root[]`, `newRootDraft: { name: string; uri: string }`, handlers.
- **Callbacks → core hook**: `useRoots` (v2-only — no v1.5 analog).
- **Internal refactors**: Use schema `Root`; replace `path` field with `uri`.

### SamplingRequestPanel

- **Location**: `groups/SamplingRequestPanel/`
- **Purpose**: Full review panel for an incoming `sampling/createMessage` request — messages, model preferences, parameters, tools, draft response.
- **Current props**: `messages`, `modelHints?`, `cost/speed/intelligencePriority?`, `maxTokens?`, `stopSequences?`, `temperature?`, `includeContext?`, `tools?`, `toolChoice?`, `responseText`, `modelUsed`, `stopReason`, handlers.
- **MCP schema touch points**: `CreateMessageRequest.params` (`messages: SamplingMessage[]`, `modelPreferences: ModelPreferences`, `systemPrompt`, `includeContext`, `temperature`, `maxTokens`, `stopSequences`, `metadata`), `CreateMessageResult` (`role`, `content`, `model`, `stopReason`). `tools`/`toolChoice` are NOT in 2025-11-25 `CreateMessageRequest` — Inspector extension or drop.
- **Target props**: `request: CreateMessageRequest`, `draftResult: CreateMessageResult`, `onResultChange`, `onAutoRespond`, `onSend`, `onReject`.
- **Callbacks → core hook**: the pending-sampling queue (handled inside `InspectorClient`; v2 pending-queue hook TBD).
- **Internal refactors**: Destructure all preferences/parameters from the embedded request; drop or fence off non-schema `tools`/`toolChoice`.

### SchemaForm

- **Location**: `groups/SchemaForm/`
- **Purpose**: Generic JSON Schema → Mantine form renderer used by tool calls, elicitation, and structured prompt inputs.
- **Current props**: `schema: JsonSchema` (local), `values`, `onChange`, `disabled?`.
- **MCP schema touch points**: JSON Schema as appearing in `Tool.inputSchema`, `Tool.outputSchema`, and `ElicitRequest.params.requestedSchema` (restricted to `PrimitiveSchemaDefinition`).
- **Target props**: `schema: JSONSchema` (shared `core/` type, not Inspector-local `JsonSchema`), `values: Record<string, unknown>`, `onChange`, `disabled?`.
- **Callbacks → core hook**: `onChange` is UI-local; committed values forwarded via consumer's hook (`useTools`/`useElicitation`/etc.).
- **Internal refactors**: Replace local `JsonSchema` with shared type; add `$ref`/`allOf`/nullable/format-aware widgets.

### ServerAddMenu

- **Location**: `groups/ServerAddMenu/`
- **Purpose**: Dropdown to add a server manually or import config/`server.json`.
- **Current props**: `onAddManually`, `onImportConfig`, `onImportServerJson`.
- **MCP schema touch points**: None — Inspector-core-owned.
- **Target props**: Unchanged.
- **Callbacks → core hook**: `useServers` (v2-only — no v1.5 analog) (and `useServerRegistry` for import).
- **Internal refactors**: None.

### ServerCard

- **Location**: `groups/ServerCard/`
- **Purpose**: Card for a configured server with status, transport, connection toggle, actions, and test-client-features menu.
- **Current props**: `id`, `name`, `version?`, `transport`, `command`, `status`, `retryCount?`, `error?`, `activeServer?`, action handlers. (The grey transport descriptor next to the `TransportBadge` is derived from `config.type` — "Standard I/O", "SSE (Server Sent Events) [deprecated]", or "Streamable HTTP" — not a separate `connectionMode` prop. The "Test Client Features" dropdown was removed; sampling/elicitation/roots simulators live elsewhere.)
- **MCP schema touch points**: `Implementation` (server `name`, `version`) from `InitializeResult.serverInfo`. Transport/command/status are Inspector-core-owned (connection lifecycle).
- **Target props**: `id: string` (the `MCPConfig.mcpServers` map key), `name: string` (display label), `config: InspectorServerConfig`, `info?: Implementation`, `connection: InspectorConnectionState` (`status`, `retryCount`, `error`), `activeServer?` (read-only — set by the wiring layer), action handlers all keyed by `id`.
- **Callbacks → core hook**: `onToggleConnection(id)` from `useConnection` — the wiring layer reads the current `connection.status` for that id and dispatches connect or disconnect (no separate `onSetActiveServer`; active state is owned by the wiring layer); `onEdit`/`onClone`/`onRemove` from `useServers`.
- **Internal refactors**: Replace flat scalar props with grouped objects; **move the auto-connect `useEffect` out** — dumb components must not self-dispatch side effects.

### ServerInfoContent

- **Location**: `groups/ServerInfoContent/`
- **Purpose**: Modal content showing server identity, capabilities, instructions, OAuth.
- **Current props**: `name`, `version`, `protocolVersion`, `transport`, `serverCapabilities`, `clientCapabilities`, `instructions?`, `oauthDetails?`.
- **MCP schema touch points**: `InitializeResult` (`serverInfo: Implementation`, `protocolVersion`, `capabilities: ServerCapabilities`, `instructions?`), `ClientCapabilities`.
- **Target props**: `initializeResult: InitializeResult`, `clientCapabilities: ClientCapabilities`, `transport: InspectorTransportType`, `oauth?: InspectorOAuthDetails`.
- **Callbacks → core hook**: read-only; data from `useConnection` / `useServerCapabilities`.
- **Internal refactors**: Derive capability list by iterating the `ServerCapabilities` record rather than a pre-built `CapabilityInfo[]`.

### ServerListControls

- **Location**: `groups/ServerListControls/`
- **Purpose**: Top-right toolbar with compact-list toggle and add-server menu.
- **Current props**: `compact`, `serverCount`, `onToggleList`, plus `AddServerMenuProps`.
- **MCP schema touch points**: None (Inspector-core-owned).
- **Target props**: Unchanged.
- **Callbacks → core hook**: `useServers` (v2-only — no v1.5 analog) (+ `useServerRegistry`).
- **Internal refactors**: None.

### ServerSettingsForm

- **Location**: `groups/ServerSettingsForm/`
- **Purpose**: Per-server settings — headers, metadata, timeouts, OAuth. (The connection-mode "Via Proxy"/"Direct" toggle was removed; the inspector picks the right transport from `MCPServerConfig.type`.)
- **Current props**: `headers`, `metadata`, `connectionTimeout`, `requestTimeout`, `oauthClient*`, many handlers.
- **MCP schema touch points**: `Request._meta` passthrough is the only schema-level tie-in; the rest is Inspector-core-owned.
- **Target props**: `settings: InspectorServerSettings`, `onSettingsChange(settings)` (or keep granular setters).
- **Callbacks → core hook**: `useServers` (v2-only — no v1.5 analog).
- **Internal refactors**: Collapse props into a settings object; keep internal `KeyValueRows`.

### TaskCard

- **Location**: `groups/TaskCard/`
- **Purpose**: Expandable card for a long-running task with progress and cancel.
- **Current props**: `taskId`, `status`, `method`, `target?`, `progress?`, `progressDescription?`, `startedAt?`, `completedAt?`, `lastUpdated?`, `elapsed?`, `ttl?`, `error?`, `isListExpanded`, `onCancel`.
- **MCP schema touch points**: `Task` (from `@modelcontextprotocol/sdk/types.js`) plus `ProgressNotification.params` (`progressToken`, `progress`, `total`, `message`) and `CancelledNotification.params`. The `notifications/tasks/list_changed` signal is an Inspector extension (no SDK schema) — see `core/mcp/taskNotificationSchemas.ts`.
- **Target props**: `task: Task` (SDK type), `isListExpanded`, `onCancel(taskId)`.
- **Callbacks → core hook**: `useManagedRequestorTasks` (issues `notifications/cancelled`).
- **Internal refactors**: Replace flat scalars with the wrapper; derive display fields.

### TaskControls

- **Location**: `groups/TaskControls/`
- **Purpose**: Sidebar search + status filter + refresh/clear for tasks.
- **Current props**: `searchText`, `statusFilter?`, handlers.
- **MCP schema touch points**: `Task` (from `@modelcontextprotocol/sdk/types.js`) — the `status` field lives on the SDK `Task` type.
- **Target props**: Unchanged; status filter typed as `Task["status"]`.
- **Callbacks → core hook**: `useManagedRequestorTasks`.
- **Internal refactors**: None beyond typing.

### TaskListPanel

- **Location**: `groups/TaskListPanel/`
- **Purpose**: List of active and completed tasks.
- **Current props**: `tasks: TaskCardProps[]`, `searchText`, `statusFilter?`.
- **MCP schema touch points**: Same SDK `Task` type as TaskCard.
- **Target props**: `tasks: Task[]`, `searchText`, `statusFilter?`, `onCancel(taskId)`.
- **Callbacks → core hook**: `useManagedRequestorTasks`.
- **Internal refactors**: Pass `onCancel` through to each `TaskCard`; stop spreading prop objects.

### ToolControls

- **Location**: `groups/ToolControls/`
- **Purpose**: Searchable tool list sidebar with list-changed indicator.
- **Current props**: `tools: ToolListItemProps[]`, `listChanged`, `onRefreshList`, `onSelectTool`.
- **MCP schema touch points**: `Tool`, `ListToolsResult`, `ToolListChangedNotification`.
- **Target props**: `tools: Tool[]`, `selectedName?`, `listChanged`, `onRefreshList`, `onSelectTool`.
- **Callbacks → core hook**: `useManagedTools`.
- **Internal refactors**: Consume schema `Tool[]` directly.

### ToolDetailPanel

- **Location**: `groups/ToolDetailPanel/`
- **Purpose**: Form for invoking a selected tool — annotations, progress, execute/cancel.
- **Current props**: `name`, `title?`, `description?`, `annotations?`, `schema: JsonSchema`, `formValues`, `isExecuting`, `progress?`, handlers.
- **MCP schema touch points**: `Tool` (`name`, `title`, `description`, `inputSchema`, `annotations: ToolAnnotations`), `ToolAnnotations` (`title`, `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`), `CallToolRequest`, `ProgressNotification`.
- **Target props**: `tool: Tool`, `formValues: Record<string, unknown>`, `isExecuting`, `progress?: ProgressNotification['params']`, `onFormChange`, `onExecute(args)`, `onCancel()`.
- **Callbacks → core hook**: `useManagedTools` (wraps `tools/call` with progress token).
- **Internal refactors**: Rename local annotation flags to schema `*Hint` names; read `inputSchema` from `tool`.

### ToolListItem

- **Location**: `groups/ToolListItem/`
- **Purpose**: Row in the tool list.
- **Current props**: `name`, `title?`, `selected`, `onClick`.
- **MCP schema touch points**: `Tool`.
- **Target props**: `tool: Tool`, `selected`, `onClick()`.
- **Callbacks → core hook**: selection via `useTools`.
- **Internal refactors**: None beyond type swap.

### ToolResultPanel

- **Location**: `groups/ToolResultPanel/`
- **Purpose**: Displays the `CallToolResult` content blocks.
- **Current props**: `content: ResultContentItem[]`, `onClear`.
- **MCP schema touch points**: `CallToolResult` (`content: ContentBlock[]`, `structuredContent?`, `isError?`). `ContentBlock = TextContent | ImageContent | AudioContent | ResourceLink | EmbeddedResource`.
- **Target props**: `result?: CallToolResult`, `onClear()`.
- **Callbacks → core hook**: `onClear` UI-local; result from `useTools`.
- **Internal refactors**: Handle full `ContentBlock` union (incl. `resource_link`, embedded resources), surface `isError`, optionally render `structuredContent`.

### ViewHeader

- **Location**: `groups/ViewHeader/`
- **Purpose**: Top app header — unconnected (brand + theme) or connected (server name, tabs, disconnect).
- **Current props**: discriminated union on `connected`: `serverName`, `status`, `latencyMs`, tabs, handlers.
- **MCP schema touch points**: `Implementation.name` for `serverName`; status/latency are Inspector connection state.
- **Target props**: Connected: `serverInfo: Implementation`, `connection: InspectorConnectionState`, `activeTab`, `availableTabs`, `onTabChange`, `onDisconnect`, `onToggleTheme`. Unconnected: unchanged.
- **Callbacks → core hook**: `onDisconnect` from `useConnection`; `onTabChange` from screen/view router; `onToggleTheme` from UI theme store.
- **Internal refactors**: Replace flat header scalars with grouped objects.

<!-- /AGENT:GROUPS -->

---

## Section 3 — Screens (`clients/web/src/components/screens/`)

> Top-level per-feature screens (Tools, Prompts, Resources, Tasks, Logging,
> History, ServerList). Screens are the seam between the Inspector core hook
> layer and the dumb component tree — they destructure hook output and pass it
> down as props.

<!-- AGENT:SCREENS -->

Screens are dumb containers: they own local UI state (search text, filter
toggles, active selection, compact mode) and destructure Inspector core hook
output into props for the group components below. They do **not** call MCP
themselves — every callback passed down must originate in a core hook.

### ToolsScreen

- **Location**: `screens/ToolsScreen/ToolsScreen.tsx`
- **Purpose**: Sidebar tool list + detail panel + last-call result panel.
- **Current props**: `tools: ToolListItemProps[]`, `selectedTool?: ToolDetailPanelProps`, `result?: ToolResultPanelProps`, `listChanged: boolean`, `onRefreshList`, `onSelectTool`.
- **MCP schema touch points**: `Tool`, `ListToolsResult`, `CallToolRequest.params`, `CallToolResult`, `ToolListChangedNotification`.
- **Target props**:
  - `tools: Tool[]` — raw MCP `Tool[]` from `ListToolsResult.tools`.
  - `selectedToolName?: string` — selection is screen-local; detail derived from `tools`.
  - `callState?: { status: 'idle' | 'pending' | 'ok' | 'error'; request?: CallToolRequest['params']; result?: CallToolResult; error?: string }`.
  - `listChanged: boolean` — driven by `notifications/tools/list_changed`.
  - `onRefreshList: () => void`, `onSelectTool: (name: string) => void`, `onCallTool: (name: string, args: Record<string, unknown>) => void`.
- **Callbacks → core hook**: `useManagedTools` provides `tools`, `listChanged`, `refreshTools`, `callTool`, `lastCallResult`; backed by `useInspectorClient` for the underlying `client.request`.
- **Internal refactors**:
  - Stop flattening `Tool` into `ToolListItemProps` at the screen boundary — pass `Tool` down and let `ToolListItem` project fields.
  - Derive the selected tool from `tools.find(t => t.name === selectedToolName)` instead of receiving a pre-built `ToolDetailPanelProps`.
  - Replace the separate `result` prop with a unified `callState` so pending/error UI can be rendered by `ToolResultPanel`.

### PromptsScreen

- **Location**: `screens/PromptsScreen/PromptsScreen.tsx`
- **Purpose**: Sidebar prompt list + argument form + rendered messages.
- **Current props**: `prompts: PromptItem[]`, `selectedPrompt?: SelectedPrompt`, `messages?: PromptMessagesDisplayProps`, `listChanged`, `onRefreshList`, `onSelectPrompt`, `onArgumentChange`, `onGetPrompt`.
- **MCP schema touch points**: `Prompt`, `PromptArgument`, `ListPromptsResult`, `GetPromptRequest.params`, `GetPromptResult`, `PromptMessage`, `PromptListChangedNotification`.
- **Target props**:
  - `prompts: Prompt[]` — raw MCP `Prompt[]`.
  - `selectedPromptName?: string`; detail derived internally.
  - `argumentValues: Record<string, string>` — uncommitted form state, held in screen or lifted to a core draft store.
  - `getPromptState?: { status: 'idle' | 'pending' | 'ok' | 'error'; result?: GetPromptResult; error?: string }` — replaces the bare `messages` prop.
  - `listChanged: boolean`.
  - `onRefreshList`, `onSelectPrompt(name)`, `onArgumentChange(name, value)`, `onGetPrompt()`.
- **Callbacks → core hook**: `useManagedPrompts` provides `prompts`, `listChanged`, `refreshPrompts`, `getPrompt`, `lastGetPromptResult`; backed by `useInspectorClient`.
- **Internal refactors**:
  - Drop `PromptItem`/`SelectedPrompt` wrapper types; consume `Prompt` directly.
  - `PromptMessage[]` flows into `PromptMessagesDisplay` from `GetPromptResult.messages` verbatim.

### ResourcesScreen

- **Location**: `screens/ResourcesScreen/ResourcesScreen.tsx`
- **Purpose**: Sidebar resources/templates/subscriptions + preview + template panel.
- **Current props**: `resources: ResourceItem[]`, `templates: TemplateListItem[]`, `subscriptions: SubscriptionItem[]`, `selectedResource?`, `selectedTemplate?`, `listChanged`, plus `onRefreshList`, `onSelectUri`, `onSelectTemplate`, `onReadResource`, `onSubscribeResource`, `onUnsubscribeResource`.
- **MCP schema touch points**: `Resource`, `ResourceTemplate`, `ListResourcesResult`, `ListResourceTemplatesResult`, `ReadResourceRequest.params`, `ReadResourceResult`, `TextResourceContents`, `BlobResourceContents`, `SubscribeRequest.params`, `UnsubscribeRequest.params`, `ResourceUpdatedNotification`, `ResourceListChangedNotification`, `Annotations`.
- **Target props**:
  - `resources: Resource[]`, `templates: ResourceTemplate[]`.
  - `subscriptions: Array<{ uri: string; lastUpdated?: string }>` — app state wrapping the URIs tracked by core.
  - `selectedResourceUri?: string`, `selectedTemplateUriTemplate?: string`.
  - `readState?: { status; uri: string; result?: ReadResourceResult; error?: string }`.
  - `listChanged: boolean`.
  - `onRefreshList`, `onSelectUri(uri)`, `onSelectTemplate(uriTemplate)`, `onReadResource(uri)`, `onSubscribeResource(uri)`, `onUnsubscribeResource(uri)`.
- **Callbacks → core hook**: `useManagedResources` owns `resources`, `resourceTemplates`, `readResource`, `subscribe`/`unsubscribe`, `subscriptions`, and forwards `notifications/resources/updated` + `list_changed`.
- **Internal refactors**:
  - Replace the ad-hoc `SelectedResource` (with inlined `content: string`) with `ReadResourceResult` whose `contents` is a union of `TextResourceContents | BlobResourceContents` — preview panel must branch on type.
  - Pass `Annotations` through unmodified rather than the reduced `{ audience?: string; priority?: number }`.

### HistoryScreen

- **Location**: `screens/HistoryScreen/HistoryScreen.tsx`
- **Purpose**: Search/filter controls + scrollable list of all JSON-RPC requests and responses.
- **Current props**: `entries: HistoryEntryProps[]`, `pinnedEntries: HistoryEntryProps[]`, `onClearAll`, `onExport`.
- **MCP schema touch points**: `JSONRPCRequest`, `JSONRPCResponse`, `JSONRPCNotification`, `JSONRPCError`, `RequestId` — entries wrap these, not transform them.
- **Target props**:
  - `entries: MessageEntry[]` from `core/mcp/types.ts` (v1.5's `MessageEntry` with `timestamp: Date`, plus a local `pinned: boolean` overlay held in screen state).
  - `onClearAll`, `onExport`, `onTogglePin(id)`, `onCopy(id)`.
  - Local state `searchText` / `methodFilter` stays in screen.
- **Callbacks → core hook**: `useMessageLog` — buffers every message seen by `useInspectorClient`'s transport and exposes `entries`, `clear`, `export`, `togglePin`.
- **Internal refactors**: collapse `entries` + `pinnedEntries` into one list with a `pinned` flag; `HistoryListPanel` handles grouping.

### LoggingScreen

- **Location**: `screens/LoggingScreen/LoggingScreen.tsx`
- **Purpose**: Server log-level control + filter/visibility controls + streaming log panel.
- **Current props**: `entries: LogEntryProps[]`, `currentLevel: string`, `onSetLevel`, `onClear`, `onExport`, `autoScroll`, `onToggleAutoScroll`, `onCopyAll`.
- **MCP schema touch points**: `LoggingMessageNotification.params` (`LoggingLevel`, `logger?`, `data: unknown`), `SetLevelRequest.params.level`.
- **Target props**:
  - `entries: Array<{ receivedAt: Date; params: LoggingMessageNotification['params'] }>` (the core-owned wrapper from `LogEntry`'s target shape; `receivedAt: Date` matches v1.5's convention).
  - `currentLevel: LoggingLevel`.
  - `onSetLevel(level: LoggingLevel)`, `onClear`, `onExport`, `onCopyAll`, `autoScroll`, `onToggleAutoScroll`.
  - `filterText` and `visibleLevels` stay screen-local.
- **Callbacks → core hook**: `useMessageLog` — subscribes to `notifications/message`, buffers entries, exposes `entries`, `currentLevel`, `setLevel` (wraps `logging/setLevel`).

### TasksScreen

- **Location**: `screens/TasksScreen/TasksScreen.tsx`
- **Purpose**: Search/status filter + list of long-running / progress-tracked requests.
- **Current props**: `tasks: TaskCardProps[]`, `onRefresh`, `onClearHistory`.
- **MCP schema touch points**: `ProgressNotification.params` (`progressToken`, `progress`, `total?`, `message?`), `CancelledNotification.params`, `RequestId`, plus the originating request (`CallToolRequest`, `ReadResourceRequest`, etc.) and its eventual result/error.
- **Target props**:
  - `tasks: Task[]` where `Task = { id: RequestId; progressToken?: ProgressToken; method: string; params: unknown; status: 'pending' | 'progress' | 'done' | 'error' | 'cancelled'; progress?: ProgressNotification['params']; result?: unknown; error?: JSONRPCError['error']; startedAt: string; endedAt?: string }`.
  - `onRefresh`, `onClearHistory`, `onCancel(id: RequestId)`.
  - Local state `searchText` / `statusFilter` stays in screen.
- **Callbacks → core hook**: `useManagedRequestorTasks` — correlates outbound requests with `notifications/progress`, `notifications/cancelled`, and terminal responses via the transport owned by `useInspectorClient`.

### ServerListScreen

- **Location**: `screens/ServerListScreen/ServerListScreen.tsx`
- **Purpose**: Grid of configured servers with controls for add/import and compact toggle.
- **Current props**: `servers: ServerCardProps[]`, `onAddManually`, `onImportConfig`, `onImportServerJson`.
- **MCP schema touch points**: `Implementation` (server `name`/`version`), `ServerCapabilities`, `InitializeResult` — identity and capability surface reported on initialize. Transport config (`command`, `args`, `env`, `url`, `headers`) is **not** MCP schema; it is Inspector core app state.
- **Target props**:
  - `servers: ServerEntry[]` where `ServerEntry = { id: string; name: string; config: ServerTransportConfig; connection: { status: 'disconnected' | 'connecting' | 'connected' | 'error'; error?: string; initializeResult?: InitializeResult } }`.
  - `activeServer?: string` — pass-through from the wiring layer; drives card dimming. **Not** local screen state.
  - `onAddManually`, `onImportConfig`, `onImportServerJson`, `onToggleConnection(id)`, `onEditServer(id)`, `onRemoveServer(id)` — the toggle is consolidated; the wiring layer reads current connection state for that id and decides whether to connect or disconnect.
- **Callbacks → core hook**: `useServers` (v2-only — no v1.5 analog) owns the persisted config list; `useConnection` (v1.5, `core/react/useConnection.ts`) owns per-server transport lifecycle and exposes `connectionStatus`, `serverCapabilities`, `connect`, `disconnect`. `ServerListScreen` composes both via a parent view.
- **Internal refactors**:
  - Stop flattening each server into a loose `ServerCardProps`; pass `ServerEntry` and let `ServerCard` read `config` / `connection` fields.
  - `activeServer` is a prop, not local screen state — the wiring layer tracks which server is connected and passes the id down. `compact` toggle stays as local `useState`.

<!-- /AGENT:SCREENS -->

---

## Section 4 — Views (`clients/web/src/components/views/`)

> Outer shell component that holds inspector-level state (active server,
> connection status, current tab) and renders the appropriate screen.
> Receives all screen data via props so a single view can drive the whole
> application.

<!-- AGENT:VIEWS -->
### InspectorView

- **Location**: `views/InspectorView/InspectorView.tsx`
- **Purpose**: Single state-machine view that owns inspector-level state, switches `ViewHeader` between connected and unconnected modes, and renders the active screen based on the current tab. Replaces the prior `ConnectedView` / `UnconnectedView` pair (which awkwardly took `children`).
- **Internal state**:
  - `activeServer: string | undefined`
  - `connectionStatus: ConnectionStatus`
  - `initializeResult: InitializeResult | undefined`
  - `latencyMs: number | undefined`
  - `activeTab: string` (defaults to `"Servers"`; expands to all tabs once a server is connected)
  - `availableTabs: string[]`
  - `logLevel: LoggingLevel`
  - `autoScroll: boolean`
- **Current props**:
  - `servers: ServerEntry[]`
  - `tools: Tool[]`
  - `prompts: Prompt[]`
  - `resources: Resource[]`
  - `resourceTemplates: ResourceTemplate[]`
  - `subscriptions: InspectorResourceSubscription[]`
  - `logs: LogEntryData[]`
  - `tasks: Task[]`
  - `progressByTaskId?: Record<string, TaskProgress>`
  - `history: MessageEntry[]`
  - `onToggleTheme: () => void`
- **MCP schema touch points**:
  - `Implementation` / `InitializeResult` — produced internally on connect and forwarded to `ViewHeader`.
  - `ServerCapabilities` — will eventually drive `availableTabs` (currently the view exposes all tabs once connected; capability-gating is a follow-up).
  - All screen-data types (`Tool`, `Prompt`, `Resource`, `ResourceTemplate`, `Task`, `LoggingLevel`) flow straight through to the relevant screen.
- **Callbacks → core hook**:
  - Connection toggle (per-card) → `useConnection` (connect / disconnect actions).
  - `onToggleTheme` → app-level theme store, not a core hook.
  - Per-screen handlers (`onCallTool`, `onGetPrompt`, `onReadResource`, `onSetLevel`, `onCancel` …) currently stubbed as `noop`; the wiring layer will replace these with hook calls (`useManagedTools`, `useManagedPrompts`, `useManagedResources`, `useLogging`, `useTasks`, `useHistory`).
- **Internal refactors / follow-ups**:
  - Compute `availableTabs` from `initializeResult.capabilities` instead of always exposing all tabs.
  - Narrow `activeTab` / `availableTabs` to an `InspectorTab` union.
  - Once core hooks land, the view should accept the hook outputs directly rather than receive bare arrays via props (stories will continue to pass fixtures).
<!-- /AGENT:VIEWS -->

---

## Appendix — Inspector core hooks (v1.5 reference)

This section will briefly catalog the v1.5 hooks that the wiring layer will
adopt or adapt, with a pointer to where each lives in the v1.5 source tree.
Filled in alongside the Screens and Views sections since those are the
components that consume hook output directly.

<!-- AGENT:HOOKS -->

Authoritative source: [`modelcontextprotocol/inspector` v1.5/main, `core/react/`](https://github.com/modelcontextprotocol/inspector/tree/v1.5/main/core/react). v1.5 already has the full core hook surface extracted under `core/react/*.ts`; the v2 wiring layer adopts each hook by name and adapts only where v2 introduces new application state (servers list, registry, client capabilities, navigation).

v1.5 core hooks (confirmed in `core/react/`):

- **`useInspectorClient`** — `core/react/useInspectorClient.ts`. Central hook returning `{ status, capabilities, serverInfo, instructions, appRendererClient, connect, disconnect }`. `capabilities: ServerCapabilities` is a field on this hook — there is no separate `useServerCapabilities`.
- **`useManagedTools`** — `core/react/useManagedTools.ts`. Produces `{ tools: Tool[]; refresh }` and subscribes to `notifications/tools/list_changed`.
- **`useManagedPrompts`** — `core/react/useManagedPrompts.ts`. Produces `{ prompts: Prompt[]; refresh }` and subscribes to `notifications/prompts/list_changed`.
- **`useManagedResources`** — `core/react/useManagedResources.ts`. Produces `{ resources: Resource[]; refresh }` and subscribes to `notifications/resources/list_changed` + `notifications/resources/updated`.
- **`useManagedResourceTemplates`** — `core/react/useManagedResourceTemplates.ts`. Produces `{ resourceTemplates: ResourceTemplate[]; refresh }`.
- **`useManagedRequestorTasks`** — `core/react/useManagedRequestorTasks.ts`. Produces `{ tasks: Task[]; refresh }` where `Task` is the SDK type from `@modelcontextprotocol/sdk/types.js`. Correlates outbound requests with `notifications/progress`, `notifications/cancelled`, and `notifications/tasks/list_changed` (an Inspector-owned extension defined in `core/mcp/taskNotificationSchemas.ts`).
- **`useMessageLog`** — `core/react/useMessageLog.ts`. JSON-RPC message buffer (`MessageEntry[]`). Serves *both* the History screen (replaces the speculative `useHistory`) *and* the Logging screen's wire view.
- **`useStderrLog`** — `core/react/useStderrLog.ts`. Stdio stderr buffer (`StderrLogEntry[]`). Used by server-detail panels showing stderr output.
- **`useFetchRequestLog`** — `core/react/useFetchRequestLog.ts`. Auth/transport HTTP fetch buffer (`FetchRequestEntry[]`). Used by OAuth/debug panels.
- **`usePagedTools`, `usePagedPrompts`, `usePagedResources`, `usePagedResourceTemplates`, `usePagedRequestorTasks`** — `core/react/usePaged*.ts`. Paged siblings of the managed hooks above; use when the caller needs explicit cursor control.
- **`useCompletionState`** — `core/react/useCompletionState.ts`. Manages argument-completion dropdown state against `completion/complete`. Produces `CompleteResult` fragments.
- **`useConnection`** — legacy name retained in some call sites. v2 routes per-server connection lifecycle through `useInspectorClient`'s `connect` / `disconnect` plus its `status` field. Where `useConnection` is referenced in this document for per-server actions, read it as "the connection slice of `useInspectorClient`".

Server→client request handling (elicitation, sampling, roots) — no discrete v1.5 hook:

- **Elicitation** (`elicitation/create`) — handled inside `InspectorClient` (`core/mcp/elicitationCreateMessage.ts`) via SDK request handlers; see `core/mcp/inspectorClient.ts`. v2 will need a small UI-state hook for the pending-elicitation queue, but it doesn't exist yet — for now, screens hold the pending queue in local state lifted to the wiring layer.
- **Sampling** (`sampling/createMessage`) — handled inside `InspectorClient` (`core/mcp/samplingCreateMessage.ts`) via SDK request handlers. Same treatment as elicitation: v2 wiring layer holds the pending queue.
- **Roots** (`roots/list`) — configured via `InspectorClientOptions.roots: Root[]` at construction time and answered by an SDK request handler inside `InspectorClient`. No React hook exists. v2 may introduce one; until then, roots flow through client options.

v2-only hooks (no v1.5 analog — to be introduced alongside the wiring layer):

- **`useServers`** — persisted list of configured server entries (transport config + last-known identity) independent of any live connection. v2-only.
- **`useServerRegistry`** — registry browser / import-from-`server.json` flow. v2-only.
- **`useClientCapabilities`** — advertises/toggles client-side capabilities (sampling, elicitation form/URL, roots, receiver-tasks) that `InspectorClient` reports during `initialize`. v2-only.
- **`useInspectorNavigation`** — tab/screen routing state. v2 may not introduce a dedicated hook; tab state can be `useState` in the wiring layer if screen count stays small.

Non-MCP utility hooks present in v1.5 (`useToast`, `useCopy`, `useTheme`, `useDraggablePane`) are orthogonal to the schema contract and will be adopted as-is or replaced by Mantine equivalents.

<!-- /AGENT:HOOKS -->

---

## Appendix B — Inspector core return types: raw MCP vs. wrappers

### Summary answer
The v1.5/main inspector core returns a deliberate mix: **raw MCP SDK types for primitive lists and individual message payloads**, and **Inspector-owned wrapper types only where the MCP schema has no equivalent concept** (history entries, fetch logs, stderr logs, invocation caches, transport/server configs). The handshake is never surfaced as an `InitializeResult` object — it is decomposed into discrete reactive fields (`capabilities`, `serverInfo`, `instructions`) on the `useInspectorClient` result.

### Handshake (`InitializeResult`)
`InitializeResult` is not imported or re-exported anywhere in `core/` or `clients/web/src/App.tsx`. The `Client` from `@modelcontextprotocol/sdk/client/index.js` is owned by `InspectorClient` and its initialize result is split at the class boundary. `useInspectorClient` exposes the pieces as separate reactive fields, all raw SDK types:

- `core/react/useInspectorClient.ts:11-19` — `UseInspectorClientResult` has `status: ConnectionStatus`, `capabilities?: ServerCapabilities`, `serverInfo?: Implementation`, `instructions?: string`, `appRendererClient: AppRendererClient | null`, plus `connect` / `disconnect`.
- `core/react/useInspectorClient.ts:30-38` — state is fed from `inspectorClient.getCapabilities()`, `getServerInfo()`, `getInstructions()` and updated via `capabilitiesChange` / `serverInfoChange` / `instructionsChange` events.
- `clients/web/src/App.tsx:584-588` — web consumer destructures `capabilities: serverCapabilities, serverInfo: serverImplementation` from the hook.

### Primitive lists (Tools / Prompts / Resources / ResourceTemplates)
All hooks return raw SDK arrays directly — no wrapping:

- `core/react/useManagedTools.ts:4,8-11` — `tools: Tool[]`, `refresh: () => Promise<Tool[]>` (`Tool` imported from `@modelcontextprotocol/sdk/types.js`).
- `core/react/useManagedPrompts.ts:4,8-11` — `prompts: Prompt[]`.
- `core/react/useManagedResources.ts:4,8-11` — `resources: Resource[]`.
- `core/react/useManagedResourceTemplates.ts` — `resourceTemplates: ResourceTemplate[]` (same pattern).
- `core/react/usePagedTools.ts:11-15` — `tools: Tool[]` plus a `loadPage(cursor?)` returning `LoadPageResult` (a core-owned `{ tools, nextCursor }` page shape defined in `core/mcp/state/pagedToolsState.ts`).

Tabs receive these as `Tool[]` / `Prompt[]` / `Resource[]` props (`clients/web/src/components/ToolsTab.tsx`, `PromptsTab.tsx`, `ResourcesTab.tsx`) — no wrapper layer between hook and component.

### Notifications & streams (logs, progress, sampling, elicitation, roots)
Server notifications are raw SDK `ServerNotification` values, but they reach the UI *inside* a history wrapper (`MessageEntry`). `clients/web/src/App.tsx:174` holds `useState<ServerNotification[]>` and `App.tsx:675-676` derives it from the message log by filtering and casting `msg.message as ServerNotification`. Progress, sampling/createMessage, elicit, and roots/list are all delivered through the same `MessageEntry` stream — the payload itself is the raw JSON-RPC message from the SDK (`clients/web/src/lib/notificationTypes.ts` just re-exports the SDK union schema).

### Inspector-owned wrapper types
Defined in `core/mcp/types.ts`:

- **`MessageEntry`** (`types.ts:61-72`) — `{ id, timestamp, direction: "request"|"response"|"notification", message: JSONRPCRequest|JSONRPCNotification|JSONRPCResultResponse|JSONRPCErrorResponse, response?, duration? }`. The UI-history wrapper around raw JSON-RPC payloads. Consumed via `useMessageLog` (`core/react/useMessageLog.ts:7-9`).
- **`FetchRequestEntry`** (`types.ts:76-91`) — `{ id, timestamp, method, url, requestHeaders, requestBody?, responseStatus?, responseStatusText?, responseHeaders?, responseBody?, duration?, error?, category: "auth"|"transport" }`. Non-MCP transport-layer log used by `useFetchRequestLog`.
- **`StderrLogEntry`** (`types.ts:44-47`) — `{ timestamp, message }`. Stdio stderr buffer used by `useStderrLog`.
- **`ResourceReadInvocation` / `ResourceTemplateReadInvocation` / `PromptGetInvocation` / `ToolCallInvocation`** (`types.ts:167-214`) — invocation caches pairing request params + a raw SDK result (`ReadResourceResult`, `GetPromptResult`, `CallToolResult`) with `timestamp`, `success`, `error`, `metadata`.
- **`ConnectionStatus`** (`types.ts:38-42`) — `"disconnected"|"connecting"|"connected"|"error"` string union.
- **`ServerState`** (`types.ts:143-153`) — aggregated snapshot `{ status, error, capabilities?, serverInfo?, instructions?, resources, prompts, tools, stderrLogs }`. Used by non-React consumers (CLI/TUI); React hooks split this across individual hooks.
- **`MCPServerConfig`** (`types.ts:2-32`) — discriminated union `StdioServerConfig | SseServerConfig | StreamableHttpServerConfig`, plus `MCPConfig` (`{ mcpServers: Record<string, MCPServerConfig> }`) and `ServerType`. These describe how the inspector connects to a server and are entirely inspector-owned (not MCP schema).

Notably there are **no** wrapper types for pending requests, sampling approvals, elicitation dialogs, or roots as first-class shapes — those flows are coordinated through the raw SDK request handlers inside `InspectorClient` with UI state living locally in `App.tsx`.

### Implications for v2 dumb components
- Accept raw SDK types directly as props wherever v1.5 does: `Tool`, `Prompt`, `Resource`, `ResourceTemplate`, `ServerCapabilities`, `Implementation`, `ReadResourceResult`, `GetPromptResult`, `CallToolResult`, `LoggingMessageNotification`, `Root`. No need to re-wrap.
- Treat the handshake as three independent props (`serverInfo`, `capabilities`, `instructions`) rather than an `InitializeResult` object — matches both v1.5 hook shape and React's reactive-granularity preference. If v2 wants whole-object ergonomics, derive an `InitializeResult` view in the hook layer, not in components.
- Inspector-owned wrappers that v2 `core/` must define (and that dumb components should consume): `MessageEntry` (history/pending-request display), `FetchRequestEntry`, `StderrLogEntry`, `ConnectionStatus`, the `MCPServerConfig` discriminated union, and the invocation cache types (`ToolCallInvocation`, `PromptGetInvocation`, `ResourceReadInvocation`, `ResourceTemplateReadInvocation`).
- "Server" in the inspector sense is a config entry (`MCPServerConfig` in `core/mcp/types.ts`), not an MCP concept — v2 `ServerCard` etc. should take this inspector-owned type plus a separate `ConnectionStatus`, never an SDK type.
- Notifications for UI history should stay as `MessageEntry` (with the raw `ServerNotification` union inside `.message`) rather than introducing a parallel `NotificationEntry` wrapper — v1.5 intentionally unifies request/response/notification under one timestamped envelope and filters by predicate at the view layer (`App.tsx:146-147,675-676`).

Source paths (v1.5/main, SHA `632e967`): `core/react/useInspectorClient.ts`, `core/react/useManaged{Tools,Prompts,Resources,ResourceTemplates}.ts`, `core/react/usePaged{Tools,...}.ts`, `core/react/{useMessageLog,useStderrLog,useFetchRequestLog}.ts`, `core/mcp/types.ts`, `clients/web/src/App.tsx`, `clients/web/src/lib/notificationTypes.ts`.
