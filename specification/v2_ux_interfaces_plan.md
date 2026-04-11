# Inspector V2 UX - Component Interfaces Implementation Plan

### [Brief](README.md) | [V1 Problems](v1_problems.md) | [V2 Scope](v2_scope.md) | [V2 Tech Stack](v2_web_client.md) | V2 UX
#### [Overview](v2_ux.md) | [Features](v2_ux_features.md) | [Handlers](v2_ux_handlers.md) | [Screenshots](v2_screenshots.md) | [Components](v2_ux_components.md) | [Interfaces](v2_ux_interfaces.md) | Plan

## Goal

Refactor every component under `clients/web/src/components/` so its prop
interface aligns with the [V2 UX Component Interfaces](v2_ux_interfaces.md)
spec. After this work, every dumb component consumes either:

1. A **raw MCP schema type** imported from `@modelcontextprotocol/sdk/types.js`
   (`Tool`, `Prompt`, `Resource`, `ServerCapabilities`, `Implementation`,
   `LoggingMessageNotification`, `Task`, etc.), or
2. An **Inspector-owned wrapper type** for a UI concept that has no MCP
   equivalent (`MCPServerConfig`, `ConnectionStatus`, `MessageEntry`,
   `StderrLogEntry`, `FetchRequestEntry`, …), or
3. A **callback** with a signature shaped by the MCP request/result types
   the wiring layer will eventually pass through, or
4. **Local UI state** (search text, compact toggle, selected name, etc.)
   that is screen-owned and not derived from any MCP object.

### Sources of truth

- **MCP schema types** — `@modelcontextprotocol/sdk` (TypeScript SDK), pinned
  at the latest `1.x` line (currently `^1.29.0`). The SDK exports every type
  this plan references, including `Task` and `LoggingLevel`.
- **Inspector-owned wrapper types** — the `v1.5/main` branch of *this* repo
  is the canonical reference. v1.5 already has a complete `core/mcp/types.ts`
  (416 lines) defining every wrapper type the v2 components need:
  - `core/mcp/types.ts` — `MCPServerConfig` discriminated union
    (`StdioServerConfig`/`SseServerConfig`/`StreamableHttpServerConfig`),
    `ServerType`, `MCPConfig`, `ConnectionStatus`, `StderrLogEntry`,
    `MessageEntry`, `FetchRequestEntry`, `FetchRequestEntryBase`,
    `ServerState`, `ResourceReadInvocation`,
    `ResourceTemplateReadInvocation`, `PromptGetInvocation`,
    `ToolCallInvocation`, `InspectorClientEnvironment`, `InspectorClientOptions`,
    `CreateTransport`, `AppRendererClient`.
  - `core/mcp/taskNotificationSchemas.ts` — Inspector's
    `notifications/tasks/list_changed` zod extension (the SDK exports
    `Task` and `TaskStatusNotificationSchema` natively, but not the
    list-changed signal).
  - `core/react/useInspectorClient.ts` — `UseInspectorClientResult` shape
    (`status`, `capabilities`, `serverInfo`, `instructions`,
    `appRendererClient`, `connect`, `disconnect`).
  - `core/react/useManaged{Tools,Prompts,Resources,ResourceTemplates,RequestorTasks}.ts`
    — confirmed return shapes the screen layer will eventually consume:
    `Tool[]`, `Prompt[]`, `Resource[]`, `ResourceTemplate[]`, `Task[]`.
  - `core/react/{useMessageLog,useStderrLog,useFetchRequestLog}.ts` — log
    wrapper consumers.
  - `clients/web/src/lib/types/customHeaders.ts` — `CustomHeader` /
    `CustomHeaders` shape, used by `ServerSettingsForm`.
  - `clients/web/src/utils/schemaUtils.ts` + `clients/web/src/utils/jsonUtils.ts`
    — JSON Schema typing (`JsonValue`, `JsonSchemaType`, `JsonObject`) and
    AJV-backed validation for tool input/output schemas.

  **Rule**: when a wrapper type is needed in v2, copy the v1.5 definition
  verbatim (including field names, optionality, and `Date` vs `string`
  choices). Do not invent new names. The interfaces doc's `Inspector*`
  prefixes (e.g. `InspectorHistoryEntry`, `InspectorTask`,
  `InspectorServerConfig`, `InspectorTaskStatus`) are placeholders — they
  resolve to v1.5's actual names below.

### Name-mapping correction (interfaces doc → v1.5 source of truth)

Several names invented in `v2_ux_interfaces.md` are already defined in v1.5
and should be replaced verbatim during the refactor:

| `v2_ux_interfaces.md` placeholder | v1.5 actual | Source |
| --- | --- | --- |
| `InspectorServerConfig` | `MCPServerConfig` (discriminated union) | `core/mcp/types.ts` |
| `InspectorTransportType` | `ServerType` (`"stdio" \| "sse" \| "streamable-http"`) | `core/mcp/types.ts` |
| `ConnectionStatus` | `ConnectionStatus` (already named that — `"disconnected" \| "connecting" \| "connected" \| "error"`) | `core/mcp/types.ts` |
| `InspectorHistoryEntry` | `MessageEntry` (note `timestamp: Date`, not `string`) | `core/mcp/types.ts` |
| `InspectorTask` | `Task` (raw SDK type — exported by MCP SDK 1.x at `@modelcontextprotocol/sdk/types.js`) | SDK |
| `InspectorTaskStatus` | Status field on the SDK `Task` type — no separate wrapper needed | SDK |
| `InspectorLogEntry` | (consume `LoggingMessageNotification['params']` directly, plus a v2-side `{ id, receivedAt }` lift) | SDK + light wrapper |
| `InspectorPendingRequest` | No first-class wrapper in v1.5 — pending sampling/elicitation flows are coordinated as raw SDK request handlers inside `InspectorClient` with UI state living locally. v2 may need a small `{ id, request }` wrapper if the dumb component needs an id key — keep it minimal. | n/a |
| `InspectorResourceSubscription` | No dedicated wrapper in v1.5; v2 should add `{ resource: Resource; lastUpdated?: Date }` per the interfaces spec, placed in `core/mcp/types.ts` alongside the others. | new (v2-only) |
| `InspectorOAuthDetails` | `InspectorClientOptions['oauth']` shape from `core/mcp/types.ts` (`clientId`, `clientSecret`, `clientMetadataUrl`, `scope`) | `core/mcp/types.ts` |
| `InspectorServerJsonDraft` | No v1.5 equivalent — v2-only. Keep the wrapper but place it in `core/mcp/types.ts` next to `MCPConfig`. | new (v2-only) |
| `InspectorServerSettings` | Closest v1.5 analog is `InspectorClientOptions` (timeouts, OAuth, sampling/elicit/roots flags). Settings form should accept the relevant subset. | `core/mcp/types.ts` |
| `InspectorRequestHistoryItem` | Subset of `MessageEntry` filtered to outbound requests. No new type needed. | `core/mcp/types.ts` |
| `InspectorUrlElicitRequest` | URL-mode elicitation IS supported by v1.5 via `InspectorClientOptions.elicit: { url: true }`; the request/response shape lives in `core/mcp/elicitationCreateMessage.ts`. v2 should mirror that file's types rather than invent. | `core/mcp/elicitationCreateMessage.ts` |
| `InspectorTab` | No v1.5 analog — v2-only enum. Place under `clients/web/src/types/` or alongside `ViewHeader`. | new (v2-only) |

## Non-goals

- **Building the v2 `core/` hook layer.** This plan only refactors component
  prop interfaces and their Storybook fixtures. The hooks (`useTools`,
  `usePrompts`, `useConnection`, etc.) that will eventually populate those
  props are out of scope here. They'll arrive in a separate effort, and the
  contracts produced by this work will be the input spec for that effort.
- **Wiring `App.tsx` to the MCP transport.** The current `App.tsx` is a
  42-line theme-toggle shell. It stays that way until the core hook layer
  exists.
- **Updating CLI / TUI clients.** Those don't exist yet in this repo.
- **Changing the visual design** of any component. Refactors are interface-only;
  Storybook output should look identical (same screenshots) unless a new field
  becomes visible because it was previously dropped (e.g. `Annotations` on
  `ResourceListItem`).
- **Adding tests** beyond what Storybook gives us. Vitest unit tests for the
  refactored components are a follow-up — the AGENTS.md 90% coverage rule will
  be addressed in its own pass once the interface dust settles.

## Current state (snapshot taken on this branch)

- `clients/web/` is the only client. No `core/`, no `cli/`, no `tui/`, no
  shared `clients/launcher/`.
- `clients/web/src/App.tsx` is a 42-line `MantineProvider` shell — no wiring.
- `clients/web/package.json` has **no** `@modelcontextprotocol/sdk` dependency.
- Components live under `clients/web/src/components/{elements,groups,screens,views}`,
  each in its own folder with `<Name>.tsx` + `<Name>.stories.tsx`.
- Component count: **16 elements**, **37 groups**, **7 screens**, **2 views**
  = 62 components.
- Components use ad hoc local types and flat scalar props (`name: string`,
  `version: string`, `transport: "stdio" | "http"`, `level: LogLevel`, …)
  invented during the visual-design phase. Several local re-declarations
  exist for what should be schema types: `JsonSchema`, `LogLevel`,
  `PromptItem`, `ResourceItem`, `ToolListItemProps`, `TaskStatus`,
  `RootEntry`, etc.

## Phase 0 — Foundations

Before any component is touched, decide and stand up the things every later
phase depends on.

### 0.1 Add the MCP SDK as a dependency

- Add `@modelcontextprotocol/sdk` to `clients/web/package.json` so component
  files can `import type { Tool, Prompt, Resource, Task, LoggingLevel, ... }
  from "@modelcontextprotocol/sdk/types.js";`.
- Pin to **`^1.29.0`** (latest 1.x line as of writing). v1.5 is on `^1.25.2`,
  but the 1.29 schema bundle is a strict superset and includes the latest
  task / progress refinements.
- Verify TypeScript path resolution by importing one type into a throwaway
  test file and running `npm run build`.
- If 1.29 introduces a breaking change vs 1.25 that affects a wrapper type
  copied from v1.5, prefer adapting the v2 wrapper to 1.29 — do not roll the
  SDK back.

### 0.2 Stand up the Inspector wrapper-types module

The interfaces doc invents `Inspector*` wrapper names; the v1.5 branch of
this repo has the canonical definitions under different (cleaner) names. Use
v1.5 as the source of truth — see the **Sources of truth** and
**Name-mapping correction** sections above.

**Decision: create `core/mcp/types.ts` in v2** at the same path v1.5 uses,
copying the types-only subset of v1.5's `core/mcp/types.ts` verbatim. This
sets up the directory structure for the eventual v2 core hook layer (which
is out of scope for this plan but will arrive in a follow-up effort) and
avoids two consecutive renames.

**Subset to copy from v1.5 `core/mcp/types.ts`** (types only — no runtime
helpers, no `InspectorClient` constructor types):

- `StdioServerConfig`, `SseServerConfig`, `StreamableHttpServerConfig`,
  `MCPServerConfig`, `ServerType`, `MCPConfig`
- `ConnectionStatus`
- `StderrLogEntry`
- `MessageEntry` (note: `timestamp: Date`, not `string`)
- `FetchRequestEntry`, `FetchRequestEntryBase`, `FetchRequestCategory`
- `ServerState`
- `ResourceReadInvocation`, `ResourceTemplateReadInvocation`,
  `PromptGetInvocation`, `ToolCallInvocation`

**Skip from v1.5** (transport / OAuth / lifecycle types — these belong in
the eventual v2 core hook layer, not this plan):

- `CreateTransport`, `CreateTransportOptions`, `CreateTransportResult`
- `InspectorClientEnvironment`, `InspectorClientOptions`, `AppRendererClient`

**Add new in v2** (v2-only wrappers needed by the interfaces refactor that
have no v1.5 equivalent):

- `InspectorResourceSubscription` = `{ resource: Resource; lastUpdated?: Date }`
- `InspectorServerJsonDraft` = `{ rawText: string; parsed?: RegistryServerJson; selectedPackageIndex?: number; envOverrides: Record<string, string>; nameOverride?: string }`
- `InspectorTab` enum (`"tools" | "prompts" | "resources" | "logs" | "tasks" | "history"`)

**Tab enum placement**: `InspectorTab` is a UI-routing concept, not an MCP
or transport concept. Place it under `clients/web/src/types/navigation.ts`
rather than in `core/mcp/types.ts`. Everything else lives in `core/mcp/types.ts`.

**Custom headers**: copy `clients/web/src/lib/types/customHeaders.ts` from
v1.5 verbatim. It owns `CustomHeader` / `CustomHeaders` shape used by
`ServerSettingsForm` and the experimental panel.

**JSON Schema typing for `SchemaForm`**: copy v1.5's
`clients/web/src/utils/jsonUtils.ts` (defines `JsonValue`, `JsonObject`,
`JsonSchemaType`) and `clients/web/src/utils/schemaUtils.ts` (AJV-backed
validators). This resolves the JSON Schema typing risk and keeps
`SchemaForm` aligned with how v1.5 validates `Tool.inputSchema` and
`Tool.outputSchema`.

**Elicitation URL request shape**: copy the URL-mode elicitation
request/result types from v1.5 `core/mcp/elicitationCreateMessage.ts` into
the new `core/mcp/types.ts` (or a peer file). The interfaces doc's
`InspectorUrlElicitRequest` placeholder maps to whatever v1.5 calls them.

### 0.3 Inventory current local re-declarations to delete

Run a single pass to find every local type that will be replaced by an MCP
schema type or a wrapper. Add a checklist to the PR description so reviewers
can confirm all of them are gone by the end:

- `JsonSchema` (in `groups/SchemaForm/SchemaForm.tsx`) → `JsonSchemaType`
  from the new `clients/web/src/utils/jsonUtils.ts` (copied from v1.5).
- `LogLevel` (in `elements/LogEntry/LogEntry.tsx`) → `LoggingLevel` from the
  SDK.
- `TaskStatus` (in `groups/TaskCard/TaskCard.tsx`) → status field on the SDK
  `Task` type. **Do not introduce a separate `InspectorTaskStatus`.**
- `TaskCardProps`-as-data-shape (in `groups/TaskListPanel/TaskListPanel.tsx`)
  → SDK `Task[]`.
- `PromptItem`, `SelectedPrompt` → `Prompt`.
- `ResourceItem`, `TemplateListItem`, `SubscriptionItem` → `Resource`,
  `ResourceTemplate`, `InspectorResourceSubscription`.
- `ToolListItemProps`-as-data-shape → `Tool`.
- `RootEntry` → `Root`.
- `KeyValuePair` (in `ServerSettingsForm`) → keep, but reconcile with
  `CustomHeader` from v1.5; if the form is editing custom headers
  specifically, prefer `CustomHeader`.
- Inline `ConnectionStatus` literal unions in multiple components
  (e.g. `ServerStatusIndicator`, `ServerCard`, `ConnectedView`) → import
  `ConnectionStatus` from `core/mcp/types.ts`.
- Inline `"stdio" | "http"` transport unions (e.g. `TransportBadge`) →
  `ServerType` from `core/mcp/types.ts`.

Output of 0.3 lives in the PR description, not in this file.

## Phase 1 — Elements (16 components)

> Smallest blast radius, fewest dependencies, and the type changes here
> propagate up. Do this first so groups can immediately consume the new
> element shapes.

### Strategy

- One commit per element (or one commit per logical batch of 2–3 closely
  related elements). Each commit refactors `<Name>.tsx`, updates
  `<Name>.stories.tsx`, and runs format/lint/build.
- For each element, the steps are mechanical:
  1. Read `v2_ux_interfaces.md` Section 1's entry for the component.
  2. Replace the current props interface with the **Target props** from the spec.
  3. Update the body to read fields off the new prop shape.
  4. Update the story `args` to construct realistic schema fixtures (use real
     `LoggingLevel` strings, real `Annotations` objects, etc.).
  5. Run `npm run format && npm run lint && npm run build`.

### Order (rough dependency order)

1. **Pure presentational, no behavior change** (warm-up):
   `CopyButton`, `ListToggle`, `ListChangedIndicator`, `SubscribeButton` —
   spec says "unchanged" or trivial.
2. **Schema-typed primitives** that other elements depend on:
   `LogLevelBadge` (introduces `LoggingLevel`), `TransportBadge` (introduces
   `InspectorTransportType`), `TaskStatusBadge` (introduces
   `InspectorTaskStatus`), `ServerStatusIndicator` (introduces
   `ConnectionStatus`).
3. **Components consuming MCP wrapper objects**:
   `AnnotationBadge` (consumes `Annotations`/`ToolAnnotations`),
   `CapabilityItem` (consumes `keyof ServerCapabilities`),
   `LogEntry` (consumes `LoggingMessageNotification['params']` + receivedAt),
   `MessageBubble` (consumes `SamplingMessage`/`PromptMessage`),
   `ProgressDisplay` (consumes `ProgressNotification['params']`).
4. **Composite-input elements**:
   `ContentViewer` (consumes the full `ContentBlock` discriminated union),
   `InlineError` (consumes `JSONRPCError['error']`),
   `ConnectionToggle` (split single `onChange` into `onConnect`/`onDisconnect`).

### Validation per element

- `npm run format && npm run lint && npm run build` (this is the project rule
  in `AGENTS.md`).
- Open the element's story in Storybook locally; visual output should be
  unchanged unless the spec calls out a new visible field.

### Phase 1 checkpoint

- Single commit on the branch summarizing the elements pass, OR a stack of
  smaller commits — preference: small commits.
- Before moving to Phase 2, scan `clients/web/src/components/elements/` for
  any remaining local-union literal types that should have been replaced.
  Delete the dead local types.

## Phase 2 — Groups (37 components)

> The bulk of the schema surface flows through this layer. Most groups embed
> 1–3 elements that already changed in Phase 1, so doing groups *after* Phase
> 1 means we only touch each file once.

### Strategy

- **One PR per logical group cluster** (not one PR per component) — clusters
  below. Each PR refactors all components in the cluster, updates their
  stories, and runs format/lint/build.
- For groups whose props are mostly a flat copy of an MCP schema object
  (`ToolListItem`, `ResourceListItem`, `PromptListItem`, `ToolControls`,
  `PromptControls`, `ResourceControls`, `RootsTable`, `LogStreamPanel`,
  `LogControls`), the refactor is mechanical: import the schema type, swap
  the local prop name, update story fixtures.
- For groups that wrap a single full panel of state (`ToolDetailPanel`,
  `ResourcePreviewPanel`, `ResourceTemplatePanel`, `SamplingRequestPanel`,
  `ElicitationFormPanel`, `ElicitationUrlPanel`, `PromptArgumentsForm`),
  the refactor moves multiple flat scalar props into a single schema or
  wrapper object and updates internal destructuring.
- For groups that flag a **dumb-component principle violation** (notably
  `ServerCard`'s auto-connect `useEffect`), the violation is fixed in the
  same commit that refactors the props — do not let it linger.

### Cluster order (within Phase 2)

1. **Tools cluster** — `ToolListItem`, `ToolControls`, `ToolDetailPanel`,
   `ToolResultPanel`. All consume `Tool` / `CallToolRequest` /
   `CallToolResult` / `ToolAnnotations`.
2. **Prompts cluster** — `PromptListItem`, `PromptControls`,
   `PromptArgumentsForm`, `PromptMessagesDisplay`. All consume `Prompt` /
   `PromptArgument` / `GetPromptResult` / `PromptMessage`.
3. **Resources cluster** — `ResourceListItem`, `ResourceControls`,
   `ResourcePreviewPanel`, `ResourceTemplatePanel`, `ResourceSubscribedItem`.
   Consume `Resource` / `ResourceTemplate` / `ReadResourceResult` /
   `Text|BlobResourceContents` / `Annotations`.
4. **Logs cluster** — `LogControls`, `LogStreamPanel`. Consume `LoggingLevel`,
   `LoggingMessageNotification['params']`.
5. **Tasks cluster** — `TaskCard`, `TaskControls`, `TaskListPanel`. Introduce
   `InspectorTask` wrapper.
6. **History cluster** — `HistoryControls`, `HistoryEntry`, `HistoryListPanel`.
   Introduce `InspectorHistoryEntry` wrapper.
7. **Sampling / elicitation cluster** — `SamplingRequestPanel`,
   `InlineSamplingRequest`, `ElicitationFormPanel`, `ElicitationUrlPanel`,
   `InlineElicitationRequest`, `PendingClientRequests`. Consume
   `CreateMessageRequest`/`Result`, `ElicitRequest`/`Result`,
   `InspectorUrlElicitRequest`, `InspectorPendingRequest`.
8. **Roots / Schema / Experimental cluster** — `RootsTable` (consumes `Root`),
   `SchemaForm` (consumes shared JSON Schema type),
   `ExperimentalFeaturesPanel` (consumes
   `ServerCapabilities['experimental']`, `ClientCapabilities['experimental']`,
   `JSONRPCRequest`/`Response`/`Error`).
9. **Server / settings / view-shell cluster** — `ServerCard` (**also** lifts
   the auto-connect `useEffect`), `ServerInfoContent`, `ServerSettingsForm`,
   `ServerListControls`, `ServerAddMenu`, `ImportServerJsonPanel`,
   `ViewHeader`. Consume `Implementation`, `InitializeResult`,
   `ServerCapabilities`, `ClientCapabilities`, `InspectorServerConfig`,
   `InspectorServerSettings`, `InspectorOAuthDetails`,
   `InspectorServerJsonDraft`, `InspectorTransportType`.

### Validation per cluster

- `npm run format && npm run lint && npm run build` after each cluster.
- Spot-check the corresponding Storybook stories visually.
- After every cluster, run a `tsc --noEmit` pass over the whole web client to
  catch consumers in screens/views that are still passing the old shape.
  Those will be temporarily broken — that's expected; screens/views are
  Phase 3 / Phase 4. To keep the build green during the transition, screens
  pass props through `as unknown as ...` adapter casts that get deleted in
  Phase 3. Alternative: do Phase 3 alongside each cluster — see below.

### Inter-phase coupling decision

There are two ways to keep the build green while groups are mid-refactor:

1. **Adapter shims** in the consuming screen for the duration of the cluster,
   deleted in Phase 3. Pro: clean per-cluster commits. Con: noisy diffs in
   screens that get rewritten anyway.
2. **Refactor each group cluster's parent screen in the same PR.** Pro: no
   shims, no temporarily-broken builds. Con: bigger PRs, but those PRs are
   the natural unit of work anyway because each cluster maps almost 1:1 to
   one screen.

**Proposed: option 2.** When the Tools group cluster is refactored, the
`ToolsScreen` is refactored in the same PR. This collapses Phase 2 and Phase
3 into a single per-feature pass and keeps `npm run build` green at every
commit.

## Phase 3 — Screens (7 components, folded into Phase 2)

Per the decision above, each screen is refactored in the same PR as its
group cluster:

- `ToolsScreen` ← Tools cluster
- `PromptsScreen` ← Prompts cluster
- `ResourcesScreen` ← Resources cluster
- `LoggingScreen` ← Logs cluster
- `TasksScreen` ← Tasks cluster
- `HistoryScreen` ← History cluster
- `ServerListScreen` ← Server / settings / view-shell cluster

For each screen:

1. Replace ad hoc list-of-`*Props` props with `<SchemaType>[]` arrays.
2. Move selection from a pre-built selected-detail prop (`selectedTool:
   ToolDetailPanelProps`) to a selected name/uri/id (`selectedToolName:
   string`) and derive the detail object internally via `tools.find(...)`.
3. Replace the separate `result` / `messages` props with a unified
   `callState` / `getPromptState` / `readState` discriminated union so the
   detail panel can render pending and error states uniformly.
4. Local UI state (search text, filter toggles, compact mode, selected name)
   stays in `useState` inside the screen.
5. Update the screen's stories — the existing stories carry the burden of
   exercising every prop combination. They will need new fixtures because
   they currently pass a flattened shape that no longer compiles.

### Sampling / elicitation cluster note

Sampling and elicitation flows do not have a dedicated screen — they appear
inline (`InlineSamplingRequest`, `InlineElicitationRequest`) or as modal
panels invoked from other screens (`SamplingRequestPanel`,
`ElicitationFormPanel`, `ElicitationUrlPanel`). Their cluster ends with
updates to the *stories* that mount them in modals (`UnconnectedView ⇒
WithSettingsModal`-style and `ConnectedView ⇒ ToolsWithElicitation*Modal`-style
existing stories) rather than a screen refactor.

## Phase 4 — Views (2 components)

> Trivial after groups + screens. Finishes the refactor.

### `ConnectedView`

- Replace flat scalars `serverName`, `status`, `latencyMs`, `activeTab`,
  `availableTabs` with: `serverInfo: Implementation`, `capabilities:
  ServerCapabilities`, `connectionStatus: ConnectionStatus`, `latencyMs?:
  number`, `activeTab: InspectorTab`, `availableTabs: InspectorTab[]`.
- Compute `availableTabs` against `capabilities` rather than accepting an
  arbitrary string list.
- Forward `serverInfo` to the now-refactored `ViewHeader`.

### `UnconnectedView`

- Rename internal `HomeLayoutProps` interface to `UnconnectedViewProps`.
- No prop changes needed.
- Optional: add `connectionStatus` if the embedded header needs it.

## Phase 5 — Cleanup pass

After all four phases, sweep:

1. Delete every local type listed in Phase 0.3 that should have disappeared.
2. Run `npm run format && npm run lint && npm run build` one last time.
3. `git grep` for `JsonSchema`, `LogLevel`, `TaskStatus`, `RootEntry`,
   `ToolListItemProps`, `PromptItem`, `ResourceItem`, `SubscriptionItem`,
   `TemplateListItem`, `ServerCardProps as a data shape` — confirm zero
   matches outside of intentional kept types.
4. Update `clients/web/README.md` if there's anything in it that refers to
   the now-deleted shapes.
5. Create a follow-up issue (or PR placeholder) for the v2 `core/` package
   migration: lift `clients/web/src/types/inspector/` into `core/types/`,
   update all import paths.

## Validation strategy (whole-project)

After each phase:

- `cd clients/web && npm run format && npm run lint && npm run build`
- Visually open Storybook (`npm run storybook`) and click through the
  refactored components.
- For groups/screens that introduced or substantially changed a wrapper
  type, write at least one Storybook story that uses a fixture clearly
  derived from a real MCP SDK type (e.g. import `Tool` from the SDK in the
  story file and construct one — this catches type drift instantly).

After the whole effort:

- Read `specification/v2_ux_interfaces.md` end to end and confirm every
  component's "Internal refactors" bullet is satisfied. Mark done.
- The follow-up "build the v2 core hook layer" effort can begin with this
  branch's component contracts as its input spec.

## Risks and open questions

1. ~~**JSON Schema typing.**~~ **Resolved.** Copy v1.5's
   `clients/web/src/utils/jsonUtils.ts` (`JsonValue`, `JsonObject`,
   `JsonSchemaType`) and `clients/web/src/utils/schemaUtils.ts` (AJV-backed
   `Tool.outputSchema` validation) verbatim. `SchemaForm` switches from its
   local `JsonSchema` type to `JsonSchemaType`.
2. **`PrimitiveSchemaDefinition` for elicitation.** `ElicitRequest`'s
   `requestedSchema` is constrained to primitives. The current `SchemaForm`
   handles arbitrary schemas. The fix is either two form components or one
   form component with a primitive-only mode flag — decide during the
   sampling/elicitation cluster. Check what v1.5 does first; v1.5 already
   supports both form-mode and URL-mode elicitation per
   `InspectorClientOptions.elicit` so the constraint is already represented.
3. **`tools` / `toolChoice` on `SamplingRequestPanel`.** These fields are not
   in `CreateMessageRequest` in MCP 2025-11-25. Per the spec, the choice is
   "Inspector extension or drop". Default proposal: **drop** them; revisit if
   a future MCP revision adds them. Verify v1.5's
   `core/mcp/samplingCreateMessage.ts` does or does not surface these fields
   before deciding.
4. **`Task` is in the SDK 1.x — interfaces doc is partially stale.** The
   `v2_ux_interfaces.md` text says "MCP 2025-11-25 base schema doesn't have
   a first-class task primitive". This is no longer correct: MCP TS SDK 1.x
   exports `Task` from `@modelcontextprotocol/sdk/types.js` and v1.5 already
   uses it as a raw type via `useManagedRequestorTasks`. **Action**: during
   Phase 0, post a follow-up commit that updates the `TaskStatusBadge`,
   `TaskCard`, `TaskListPanel`, and `TasksScreen` entries in
   `v2_ux_interfaces.md` to reference `Task` directly instead of the
   `InspectorTask` placeholder. Do not silently diverge.
5. **`InspectorClientOptions` boundary.** v1.5's `InspectorClientOptions` is a
   construction-time options bag for `InspectorClient`, not a settings object
   the user edits at runtime. The `ServerSettingsForm` props need a runtime
   *subset* (timeouts, OAuth client id/secret/scope, headers, metadata,
   custom instructions, feature flags). Create a small `InspectorServerSettings`
   wrapper in `core/mcp/types.ts` that picks exactly those fields off
   `InspectorClientOptions` — do not invent a parallel hierarchy.
6. **Story bundle size.** The existing `ConnectedView.stories.tsx` is already
   long because each story inlines a full screen of fixture data. Refactoring
   each story to use real schema types will make them longer. Consider
   factoring fixtures into shared `*.fixtures.ts` files alongside the
   component, especially for tools / prompts / resources where the same
   object set is reused across multiple stories. Decide per cluster.
7. **Wrapper type names.** Use **v1.5's names verbatim**, not the
   `Inspector*` placeholders from `v2_ux_interfaces.md`. The
   "Name-mapping correction" table at the top of this plan is the
   authoritative rename list. Update `v2_ux_interfaces.md` after Phase 0 so
   the spec and the implementation agree on names.
8. **Date vs. string for timestamps.** v1.5's `MessageEntry`,
   `StderrLogEntry`, `FetchRequestEntry`, and the `*Invocation` types use
   `Date`, not ISO strings. The current Storybook stories pass ISO strings.
   When refactoring, convert fixtures to `new Date(...)`. Stories' visible
   output should not change because `Date.toISOString()` / `toLocaleString()`
   is invoked at render time anyway.
9. **Visual regressions.** The refactor is meant to be visually invisible,
   but several elements get *new* visible fields (`ResourceListItem` will
   start rendering `Annotations` it currently ignores; `LogEntry` will
   render `params.data` directly). Capture before/after Storybook
   screenshots for each cluster's PR description so reviewers can sign off.
10. **v1.5 has more state machinery than this plan touches.** v1.5 ships
    `core/mcp/state/managed{Tools,Prompts,Resources,ResourceTemplates,RequestorTasks}State.ts`
    plus `paged*State.ts` siblings, plus `core/react/useManaged*.ts` hooks
    that subscribe to them via `EventTarget`. None of that is in scope for
    this plan — only the *types* are. The hook layer build-out is the
    follow-up effort that will consume the contracts produced here.

## Out of this plan, but adjacent

- **Vitest unit tests** for each refactored component (90% per AGENTS.md).
- **Building the v2 `core/` hook layer.** v1.5 already has the full hook
  surface (`useInspectorClient`, `useManagedTools`, `useManagedPrompts`,
  `useManagedResources`, `useManagedResourceTemplates`,
  `useManagedRequestorTasks`, `useMessageLog`, `useStderrLog`,
  `useFetchRequestLog`, plus `usePaged*` siblings) and the state machinery
  it subscribes to (`core/mcp/state/managed*State.ts`,
  `core/mcp/state/paged*State.ts`). Porting that layer wholesale to v2 is a
  separate effort that will consume the component contracts produced here as
  its input spec.
- **Wiring `App.tsx`** to the v2 core hook layer.
- **CLI / TUI clients.** v1.5 has both (`clients/cli/`, `clients/tui/`); v2
  will reuse the wrapper types from `core/mcp/types.ts` once that file exists
  in v2.
- **Updating `v2_ux_interfaces.md`** to use v1.5's actual wrapper-type names
  (`MCPServerConfig`, `MessageEntry`, `Task`, etc.) instead of the
  `Inspector*` placeholders. Should be a small follow-up commit on this
  branch immediately after Phase 0 lands so the spec and the code agree.
