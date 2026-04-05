# Inspector V2 UX - Storybook Component Plan

### [Brief](README.md) | [V1 Problems](v1_problems.md) | [V2 Scope](v2_scope.md) | [V2 Tech Stack](v2_web_client.md) | V2 UX
#### [Overview](v2_ux.md) | [Features](v2_ux_features.md) | [Handlers](v2_ux_handlers.md) | [Screenshots](v2_screenshots.md) | [Components](v2_ux_components.md) | [Interfaces](v2_ux_interfaces.md) | Storybook

---

This document defines every presentational component to be built in Storybook using Mantine. Components are organized bottom-up: elements first, then groups, then screens. Each component receives all data and callbacks via props — no store access.

## Table of Contents
  * [Conventions](#conventions)
  * [Tier 1 - Elements](#tier-1---elements)
  * [Tier 2 - Groups](#tier-2---groups)
  * [Tier 3 - Screens](#tier-3---screens)
  * [Tier 4 - Page Views](#tier-4---page-views)
  * [Build Order](#build-order)
  * [Storybook Configuration](#storybook-configuration)

---

## Conventions

### File Structure
```
src/components/
  elements/
    StatusIndicator/
      StatusIndicator.tsx
      StatusIndicator.stories.tsx
    ...
  groups/
    ServerCard/
      ServerCard.tsx
      ServerCard.stories.tsx
    ...
  screens/
    ToolsScreen/
      ToolsScreen.tsx
      ToolsScreen.stories.tsx
    ...
  views/
    AppShell/
      AppShell.tsx
      AppShell.stories.tsx
    ...
```

### Props Pattern
Every component exports a `Props` interface. Callbacks use the `onVerb` convention. Boolean flags use `canVerb` or `isState` naming.

```typescript
// Example
export interface StatusIndicatorProps {
  status: 'connected' | 'connecting' | 'disconnected' | 'failed';
  latencyMs?: number;
  retryCount?: number;
}
```

### Story Pattern
Each component has at minimum a `Default` story plus stories for each meaningful state variation.

```typescript
const meta: Meta<typeof StatusIndicator> = {
  component: StatusIndicator,
  decorators: [MantineDecorator],
};

export const Connected: Story = { args: { status: 'connected', latencyMs: 23 } };
export const Failed: Story = { args: { status: 'failed', retryCount: 3 } };
```

---

## Tier 1 - Elements

Small, single-purpose components. Most map directly to a Mantine component with specific props/styling.

### 1.1 StatusIndicator

Connection status dot with label.

| Prop | Type | Description |
|------|------|-------------|
| `status` | `'connected' \| 'connecting' \| 'disconnected' \| 'failed'` | Current state |
| `latencyMs` | `number?` | Ping latency (shown when connected) |
| `retryCount` | `number?` | Retry attempts (shown when failed) |

**Mantine:** Custom component using `Box` for the dot + `Text`. Pulsing animation via CSS for `connecting`.

**Stories:** Connected, Connecting, Disconnected, Failed, FailedWithRetries

---

### 1.2 AnnotationBadge

Tag-style badge for tool/resource annotations.

| Prop | Type | Description |
|------|------|-------------|
| `label` | `string` | Badge text (e.g., "user", "read-only", "destructive") |
| `variant` | `'audience' \| 'readOnly' \| 'destructive' \| 'longRun' \| 'priority' \| 'default'` | Visual style |

**Mantine:** `Badge` with `variant` and `color` mapped from annotation type. Destructive = red outline, long-run = yellow, read-only = dark filled, audience = gray outline, priority = orange/yellow/green by level.

**Stories:** Audience, ReadOnly, Destructive, LongRun, PriorityHigh, PriorityMedium, PriorityLow, Custom

---

### 1.3 CapabilityItem

Single capability row with check/cross icon and label.

| Prop | Type | Description |
|------|------|-------------|
| `name` | `string` | Capability name |
| `supported` | `boolean` | Whether capability is available |
| `count` | `number?` | Optional count (e.g., "Tools (4)") |

**Mantine:** `Group` with `ThemeIcon` (check or X) + `Text`.

**Stories:** Supported, SupportedWithCount, NotSupported

---

### 1.4 LogEntry

Single log line with timestamp, level badge, and message.

| Prop | Type | Description |
|------|------|-------------|
| `timestamp` | `string` | Formatted time (e.g., "14:32:01") |
| `level` | `'debug' \| 'info' \| 'notice' \| 'warning' \| 'error' \| 'critical' \| 'alert' \| 'emergency'` | RFC 5424 level |
| `message` | `string` | Log message text |
| `logger` | `string?` | Logger name |

**Mantine:** `Group` with `Text` (timestamp) + `Badge` (level, color-coded) + `Text` (message). Level colors: debug=gray, info=blue, notice=teal, warning=yellow, error=red, critical=red+filled, alert=red+bold, emergency=red+filled+bold.

**Stories:** Debug, Info, Notice, Warning, Error, Critical, Alert, Emergency, WithLogger

---

### 1.5 ProgressDisplay

Progress bar with percentage and optional step description.

| Prop | Type | Description |
|------|------|-------------|
| `progress` | `number` | 0-100 percentage |
| `description` | `string?` | Current step text |
| `elapsed` | `string?` | Elapsed time display |

**Mantine:** `Progress` bar + `Text` for description and percentage.

**Stories:** ZeroPercent, HalfComplete, NearComplete, Complete, WithDescription, WithElapsed

---

### 1.6 ContentViewer

Renders text, JSON, image, or audio content with syntax highlighting.

| Prop | Type | Description |
|------|------|-------------|
| `type` | `'text' \| 'json' \| 'image' \| 'audio'` | Content type |
| `content` | `string` | The content (text, JSON string, base64, or URL) |
| `mimeType` | `string?` | MIME type for images/audio |
| `onCopy` | `() => void` | Copy callback |

**Mantine:** `Code` block for JSON/text (with `language` prop), `Image` for images, native `<audio>` for audio. Wrapped in `Paper` with light background.

**Stories:** PlainText, JsonContent, ImagePreview, AudioPlayer, LongContent

---

### 1.7 ListChangedIndicator

Yellow dot + "List updated" text + Refresh button.

| Prop | Type | Description |
|------|------|-------------|
| `visible` | `boolean` | Whether to show the indicator |
| `onRefresh` | `() => void` | Refresh callback |

**Mantine:** `Group` with animated `Box` (yellow dot) + `Text` + `Button` with refresh icon.

**Stories:** Visible, Hidden

---

### 1.8 CopyButton

Icon button that copies text and shows brief confirmation.

| Prop | Type | Description |
|------|------|-------------|
| `value` | `string` | Text to copy |

**Mantine:** `CopyButton` (built-in) with `ActionIcon` and `Tooltip`.

**Stories:** Default, LongValue

---

### 1.9 ConnectionToggle

Switch control for connecting/disconnecting a server.

| Prop | Type | Description |
|------|------|-------------|
| `checked` | `boolean` | On/off state |
| `loading` | `boolean` | Show loading state during connection |
| `disabled` | `boolean` | Disable interaction |
| `onChange` | `(checked: boolean) => void` | Toggle callback |

**Mantine:** `Switch` with `size="lg"`.

**Stories:** Connected, Disconnected, Loading, Disabled

---

### 1.10 TransportBadge

Shows transport type (STDIO, HTTP) as a styled badge.

| Prop | Type | Description |
|------|------|-------------|
| `transport` | `'stdio' \| 'http'` | Transport type |

**Mantine:** `Badge` with `variant="outline"`.

**Stories:** Stdio, Http

---

### 1.11 InlineError

Expandable error display with retry count and doc links.

| Prop | Type | Description |
|------|------|-------------|
| `message` | `string` | Short error message |
| `details` | `string?` | Full error text (shown on expand) |
| `retryCount` | `number?` | Current retry attempt |
| `maxRetries` | `number?` | Max retry attempts |
| `onShowMore` | `() => void` | Expand callback |
| `docLink` | `string?` | URL to troubleshooting guide |

**Mantine:** `Alert` with `color="red"`, `Spoiler` for expandable details.

**Stories:** ShortError, LongErrorCollapsed, LongErrorExpanded, WithRetryCount, WithDocLink

---

### 1.12 MessageBubble

Single chat message with role label and content (text, image, or audio).

| Prop | Type | Description |
|------|------|-------------|
| `index` | `number` | Message index |
| `role` | `'user' \| 'assistant'` | Message role |
| `content` | `string` | Text content |
| `imageContent` | `{ data: string; mimeType: string }?` | Optional image |
| `audioContent` | `{ data: string; mimeType: string }?` | Optional audio |

**Mantine:** `Paper` with subtle background, `Text` for role label, content display.

**Stories:** UserText, AssistantText, UserWithImage, UserWithAudio, LongMessage

---

## Tier 2 - Groups

Composed from elements. Represent distinct functional units within a screen.

### 2.1 ServerCard

Server connection card with status, transport, command, and action buttons.

| Prop | Type | Description |
|------|------|-------------|
| `name` | `string` | Server name |
| `version` | `string?` | Server version |
| `transport` | `'stdio' \| 'http'` | Transport type |
| `connectionMode` | `string` | "Via Proxy" or "Direct" |
| `command` | `string` | Command or URL |
| `status` | `'connected' \| 'connecting' \| 'disconnected' \| 'failed'` | Connection state |
| `retryCount` | `number?` | Failed retry count |
| `error` | `{ message: string; details?: string }?` | Error info |
| `canTestClientFeatures` | `boolean` | Show "Test Client Features" dropdown |
| `onToggleConnection` | `(connect: boolean) => void` | Connect/disconnect |
| `onCopyCommand` | `() => void` | Copy command |
| `onServerInfo` | `() => void` | View server info |
| `onSettings` | `() => void` | Open settings |
| `onEdit` | `() => void` | Edit server |
| `onClone` | `() => void` | Clone server |
| `onRemove` | `() => void` | Remove server |
| `onTestSampling` | `() => void` | Test sampling |
| `onTestElicitationForm` | `() => void` | Test elicitation (form) |
| `onTestElicitationUrl` | `() => void` | Test elicitation (URL) |
| `onConfigureRoots` | `() => void` | Configure roots |

**Mantine:** `Card` with `Card.Section` dividers. Uses StatusIndicator, TransportBadge, ConnectionToggle, CopyButton, InlineError elements. `Menu` for "Test Client Features" dropdown.

**Stories:** Connected, Disconnected, Connecting, Failed, FailedWithError, WithClientFeatures, HttpDirect, LongCommand

---

### 2.2 AddServerMenu

Dropdown button with options: Add manually, Import config, Import server.json.

| Prop | Type | Description |
|------|------|-------------|
| `onAddManually` | `() => void` | Add manually callback |
| `onImportConfig` | `() => void` | Import config callback |
| `onImportServerJson` | `() => void` | Import server.json callback |

**Mantine:** `Menu` with `Button` trigger ("+ Add Server" with chevron).

**Stories:** Default (closed), Open

---

### 2.3 ToolListItem

Single tool entry in the sidebar list with name and annotation badges.

| Prop | Type | Description |
|------|------|-------------|
| `name` | `string` | Tool name |
| `annotations` | `AnnotationBadge[]` | Array of annotation badges |
| `selected` | `boolean` | Whether this tool is currently selected |
| `onClick` | `() => void` | Selection callback |

**Mantine:** `NavLink` or `UnstyledButton` with `Group` of AnnotationBadge children. Active state uses background highlight.

**Stories:** Default, Selected, WithAnnotations, MultipleAnnotations, LongName

---

### 2.4 ToolDetailPanel

Tool name, description, annotations display, and generated parameter form.

| Prop | Type | Description |
|------|------|-------------|
| `name` | `string` | Tool name |
| `description` | `string?` | Tool description |
| `annotations` | `object?` | Annotations object (audience, readOnly, destructive, etc.) |
| `schema` | `object` | JSON Schema for tool input |
| `formValues` | `Record<string, unknown>` | Current form values |
| `isExecuting` | `boolean` | Whether tool is currently executing |
| `progress` | `{ percent: number; description?: string }?` | Execution progress |
| `onFormChange` | `(values: Record<string, unknown>) => void` | Form value change |
| `onExecute` | `() => void` | Execute tool callback |
| `onCancel` | `() => void` | Cancel execution callback |

**Mantine:** `Stack` with `Title`, `Text`, AnnotationBadge group, SchemaForm (see 2.12), `Button` for execute, ProgressDisplay.

**Stories:** SimpleStringParam, MultipleParams, WithAnnotations, Executing, WithProgress, ComplexSchema

---

### 2.5 ResultPanel

Displays tool execution results with copy/clear actions.

| Prop | Type | Description |
|------|------|-------------|
| `content` | `Array<{ type: string; text?: string; data?: string; mimeType?: string }>` | Result content items |
| `onCopy` | `() => void` | Copy result |
| `onClear` | `() => void` | Clear result |

**Mantine:** `Paper` with ContentViewer for each content item, `Group` with action buttons.

**Stories:** TextResult, JsonResult, ImageResult, AudioResult, MixedContent, Empty

---

### 2.6 ResourceListItem

Single resource entry with name and annotation badges.

| Prop | Type | Description |
|------|------|-------------|
| `name` | `string` | Resource display name |
| `uri` | `string` | Resource URI |
| `annotations` | `object?` | Audience and priority annotations |
| `selected` | `boolean` | Selection state |
| `onClick` | `() => void` | Selection callback |

**Mantine:** Similar to ToolListItem with AnnotationBadge.

**Stories:** Default, Selected, WithAnnotations, WithHighPriority

---

### 2.7 ResourcePreviewPanel

Resource content display with URI, MIME type, annotations, and subscribe/copy actions.

| Prop | Type | Description |
|------|------|-------------|
| `uri` | `string` | Resource URI |
| `mimeType` | `string` | MIME type |
| `annotations` | `object?` | Annotations |
| `content` | `string` | Resource content |
| `lastUpdated` | `string?` | Last update timestamp |
| `isSubscribed` | `boolean` | Subscription state |
| `onCopy` | `() => void` | Copy content |
| `onSubscribe` | `() => void` | Subscribe callback |
| `onUnsubscribe` | `() => void` | Unsubscribe callback |

**Mantine:** `Stack` with metadata `Text` items, ContentViewer, action `Button` group.

**Stories:** JsonResource, TextResource, ImageResource, Subscribed, NotSubscribed, WithAnnotations

---

### 2.8 ResourceTemplateInput

Template with inline variable inputs and Go button.

| Prop | Type | Description |
|------|------|-------------|
| `template` | `string` | URI template (e.g., "user/{id}") |
| `variables` | `Record<string, string>` | Current variable values |
| `onVariableChange` | `(name: string, value: string) => void` | Variable change |
| `onSubmit` | `() => void` | Navigate/fetch callback |

**Mantine:** `Group` with `Text` for template prefix, `TextInput` for each variable, `Button` for Go.

**Stories:** SingleVariable, MultipleVariables, FilledIn

---

### 2.9 PromptArgumentsForm

Prompt selection dropdown, description, argument form, and Get Prompt button.

| Prop | Type | Description |
|------|------|-------------|
| `prompts` | `Array<{ name: string; description?: string }>` | Available prompts |
| `selectedPrompt` | `string?` | Currently selected prompt name |
| `arguments` | `Array<{ name: string; required: boolean; description?: string }>` | Prompt arguments |
| `argumentValues` | `Record<string, string>` | Current argument values |
| `onSelectPrompt` | `(name: string) => void` | Prompt selection |
| `onArgumentChange` | `(name: string, value: string) => void` | Argument value change |
| `onGetPrompt` | `() => void` | Execute prompt |

**Mantine:** `Select` for prompt dropdown, `TextInput` for each argument with required indicator, `Button` for Get Prompt. Description shown as `Text` with dimmed color.

**Stories:** NoSelection, Selected, WithRequiredArgs, AllFilled, ManyArguments

---

### 2.10 PromptMessagesDisplay

Rendered prompt result showing role-labeled messages.

| Prop | Type | Description |
|------|------|-------------|
| `messages` | `Array<{ role: string; content: string; imageContent?: object; audioContent?: object }>` | Prompt messages |
| `onCopy` | `() => void` | Copy messages |

**Mantine:** `Stack` of MessageBubble elements, `Button` for copy.

**Stories:** SingleMessage, Conversation, WithImage, WithAudio, LongConversation

---

### 2.11 LogControls

Log level selector, text filter, level checkboxes, clear/export buttons.

| Prop | Type | Description |
|------|------|-------------|
| `currentLevel` | `string` | Active log level |
| `filterText` | `string` | Text filter value |
| `visibleLevels` | `Record<string, boolean>` | Which levels are checked |
| `onSetLevel` | `(level: string) => void` | Set log level callback |
| `onFilterChange` | `(text: string) => void` | Filter text change |
| `onToggleLevel` | `(level: string, visible: boolean) => void` | Toggle level visibility |
| `onClear` | `() => void` | Clear logs |
| `onExport` | `() => void` | Export logs |

**Mantine:** `Select` for level + `Button` "Set Level", `TextInput` for filter, `Checkbox.Group` for levels (each color-coded), `Group` with action buttons.

**Stories:** AllLevelsVisible, FilteredLevels, WithFilterText, DebugLevel, ErrorLevel

---

### 2.12 SchemaForm

Dynamic form generated from JSON Schema. Core reusable component for tool params, elicitation forms, and prompt arguments.

| Prop | Type | Description |
|------|------|-------------|
| `schema` | `object` | JSON Schema definition |
| `values` | `Record<string, unknown>` | Current form values |
| `onChange` | `(values: Record<string, unknown>) => void` | Value change callback |
| `disabled` | `boolean?` | Disable all fields |

**Mantine:** Maps schema types to Mantine inputs: `TextInput` (string), `NumberInput` (number/integer), `Checkbox` (boolean), `Select` (enum/oneOf), `MultiSelect` (array+anyOf), `JsonInput` (complex fallback). Uses `Stack` layout. Required fields marked with `withAsterisk`.

**Stories:** StringFields, NumberFields, BooleanFields, EnumDropdown, TitledEnum, MultiSelectEnum, MixedTypes, NestedObject, ArrayField, ComplexFallback, AllRequired, WithDefaults, WithDescriptions

---

### 2.13 TaskCard

Single task card with status, progress, method info, and action buttons.

| Prop | Type | Description |
|------|------|-------------|
| `taskId` | `string` | Task identifier |
| `status` | `'waiting' \| 'running' \| 'completed' \| 'failed' \| 'cancelled'` | Task state |
| `method` | `string` | MCP method (e.g., "tools/call") |
| `target` | `string?` | Tool name or resource URI |
| `progress` | `number?` | 0-100 progress percentage |
| `progressDescription` | `string?` | Current step text |
| `startedAt` | `string?` | Start timestamp |
| `completedAt` | `string?` | Completion timestamp |
| `elapsed` | `string?` | Elapsed or duration string |
| `error` | `string?` | Error message (for failed tasks) |
| `onViewDetails` | `() => void` | View details callback |
| `onViewResult` | `() => void` | View result callback |
| `onCancel` | `() => void` | Cancel task callback |
| `onDismiss` | `() => void` | Dismiss from list |

**Mantine:** `Card` with `Group` for header (task ID + status Badge + progress), `Text` for metadata, `Group` for action buttons. Status badge colors: waiting=gray, running=blue, completed=green, failed=red, cancelled=yellow.

**Stories:** Running, RunningWithProgress, Waiting, Completed, Failed, FailedWithError, Cancelled

---

### 2.14 HistoryEntry

Single request history entry with expand/collapse, replay, and pin.

| Prop | Type | Description |
|------|------|-------------|
| `timestamp` | `string` | Request timestamp |
| `method` | `string` | MCP method |
| `target` | `string?` | Tool/resource/prompt name |
| `status` | `'success' \| 'error'` | Result status |
| `durationMs` | `number` | Response time |
| `parameters` | `object?` | Request parameters |
| `response` | `object?` | Response data |
| `children` | `HistoryEntry[]?` | Nested child requests (sampling/elicitation) |
| `isPinned` | `boolean` | Pin state |
| `isExpanded` | `boolean` | Expanded state |
| `onToggleExpand` | `() => void` | Expand/collapse |
| `onReplay` | `() => void` | Replay request |
| `onTogglePin` | `() => void` | Pin/unpin |

**Mantine:** `Card` with collapsible `Collapse` section. Header `Group` with timestamp, method `Badge`, target, status Badge (green/red), duration. Children rendered indented with connector lines via CSS.

**Stories:** SuccessCollapsed, SuccessExpanded, Error, WithChildren, Pinned, PinnedWithLabel, DeepNesting

---

### 2.15 SamplingRequestPanel

Displays a sampling request with messages, model preferences, parameters, and response input.

| Prop | Type | Description |
|------|------|-------------|
| `messages` | `Array<{ role: string; content: string; imageContent?: object }>` | Request messages |
| `modelHints` | `string[]?` | Model hint strings |
| `costPriority` | `number?` | 0-1 cost priority |
| `speedPriority` | `number?` | 0-1 speed priority |
| `intelligencePriority` | `number?` | 0-1 intelligence priority |
| `maxTokens` | `number?` | Max tokens |
| `stopSequences` | `string[]?` | Stop sequences |
| `temperature` | `number?` | Temperature |
| `includeContext` | `string?` | Context inclusion |
| `tools` | `Array<{ name: string; description?: string; inputSchema: object }>?` | Available tools for tool-enabled sampling |
| `toolChoice` | `string?` | Tool choice mode |
| `responseText` | `string` | Current response text |
| `modelUsed` | `string` | Model used field |
| `stopReason` | `string` | Stop reason |
| `onResponseChange` | `(text: string) => void` | Response text change |
| `onModelChange` | `(model: string) => void` | Model field change |
| `onStopReasonChange` | `(reason: string) => void` | Stop reason change |
| `onAutoRespond` | `() => void` | Auto-respond with profile |
| `onSend` | `() => void` | Send response |
| `onReject` | `() => void` | Reject request |

**Mantine:** `Stack` with MessageBubble list, `Paper` for model preferences (Badge chips + Slider displays), parameter `Text` items, `Textarea` for response, `TextInput` for model, `Select` for stop reason, action `Button` group.

**Stories:** SimpleRequest, WithModelHints, WithPriorities, WithAllParams, WithImage, WithTools, WithToolChoice, PrefilledResponse, InlineCompact

---

### 2.16 ElicitationFormPanel

Form-based elicitation with JSON Schema-generated fields and security warning.

| Prop | Type | Description |
|------|------|-------------|
| `message` | `string` | Server's message/prompt |
| `schema` | `object` | JSON Schema for form fields |
| `values` | `Record<string, unknown>` | Current form values |
| `serverName` | `string` | Requesting server name (for warning) |
| `onChange` | `(values: Record<string, unknown>) => void` | Form change |
| `onSubmit` | `() => void` | Submit form |
| `onCancel` | `() => void` | Cancel/decline |

**Mantine:** `Stack` with message `Text`, `Divider`, SchemaForm, `Alert` with warning icon and server name, action `Button` group.

**Stories:** SimpleForm, ComplexForm, WithEnums, AllRequired, WithDefaults, LongMessage

---

### 2.17 ElicitationUrlPanel

URL-based elicitation with copy, open, and waiting indicator.

| Prop | Type | Description |
|------|------|-------------|
| `message` | `string` | Server's message |
| `url` | `string` | URL to visit |
| `elicitationId` | `string` | Elicitation ID |
| `isWaiting` | `boolean` | Waiting for completion |
| `onCopyUrl` | `() => void` | Copy URL |
| `onOpenInBrowser` | `() => void` | Open URL |
| `onCancel` | `() => void` | Cancel |

**Mantine:** `Stack` with message `Text`, `Code` block for URL, `Button` group (Copy, Open in Browser), `Loader` + status text, `Alert` with domain warning.

**Stories:** Waiting, WithLongUrl, Completed

---

### 2.18 RootsTable

Table of configured roots with remove actions and add form.

| Prop | Type | Description |
|------|------|-------------|
| `roots` | `Array<{ name: string; uri: string }>` | Configured roots |
| `newRootName` | `string` | New root name field |
| `newRootPath` | `string` | New root path field |
| `onRemoveRoot` | `(uri: string) => void` | Remove root |
| `onNewRootNameChange` | `(name: string) => void` | Name field change |
| `onNewRootPathChange` | `(path: string) => void` | Path field change |
| `onAddRoot` | `() => void` | Add root |
| `onBrowse` | `() => void` | Browse for path |

**Mantine:** `Table` for roots list with `ActionIcon` delete buttons, `Divider`, `TextInput` fields for name/path, `Group` with Browse + Add buttons, `Alert` with security warning.

**Stories:** WithRoots, Empty, AddingNew, ManyRoots

---

### 2.19 ServerInfoContent

Server metadata, capabilities, and instructions display (modal body content).

| Prop | Type | Description |
|------|------|-------------|
| `name` | `string` | Server name |
| `version` | `string` | Server version |
| `protocolVersion` | `string` | Protocol version |
| `transport` | `string` | Transport type |
| `serverCapabilities` | `Array<{ name: string; supported: boolean; count?: number }>` | Server caps |
| `clientCapabilities` | `Array<{ name: string; supported: boolean; count?: number }>` | Client caps |
| `instructions` | `string?` | Server instructions text |
| `oauthDetails` | `{ authUrl?: string; scopes?: string[]; accessToken?: string }?` | OAuth info |

**Mantine:** `SimpleGrid` cols={2} for metadata pairs, two-column CapabilityItem lists, `Blockquote` for instructions, `Paper` for OAuth details.

**Stories:** FullCapabilities, MinimalCapabilities, WithInstructions, WithOAuth, NoExperimental

---

### 2.20 ServerSettingsForm

Server settings form with connection mode, headers, metadata, timeouts, and OAuth.

| Prop | Type | Description |
|------|------|-------------|
| `connectionMode` | `'proxy' \| 'direct'` | Connection mode |
| `headers` | `Array<{ key: string; value: string }>` | Custom headers |
| `metadata` | `Array<{ key: string; value: string }>` | Request metadata |
| `connectionTimeout` | `number` | Connection timeout ms |
| `requestTimeout` | `number` | Request timeout ms |
| `oauthClientId` | `string?` | OAuth client ID |
| `oauthClientSecret` | `string?` | OAuth client secret |
| `oauthScopes` | `string?` | OAuth scopes |
| `onConnectionModeChange` | `(mode: string) => void` | Mode change |
| `onAddHeader` | `() => void` | Add header |
| `onRemoveHeader` | `(index: number) => void` | Remove header |
| `onHeaderChange` | `(index: number, key: string, value: string) => void` | Edit header |
| `onAddMetadata` | `() => void` | Add metadata |
| `onRemoveMetadata` | `(index: number) => void` | Remove metadata |
| `onMetadataChange` | `(index: number, key: string, value: string) => void` | Edit metadata |
| `onTimeoutChange` | `(field: string, value: number) => void` | Timeout change |
| `onOAuthChange` | `(field: string, value: string) => void` | OAuth field change |

**Mantine:** `Stack` with `Select` for connection mode, key-value pair sections using `Group` of `TextInput` pairs with `ActionIcon` remove buttons, `NumberInput` for timeouts, `TextInput` for OAuth fields, `Divider` between sections.

**Stories:** DefaultSettings, WithHeaders, WithMetadata, WithOAuth, AllConfigured

---

### 2.21 ImportServerJsonPanel

JSON editor with validation results, package selection, env var form, and name override.

| Prop | Type | Description |
|------|------|-------------|
| `jsonContent` | `string` | Current JSON content |
| `validationResults` | `Array<{ type: 'success' \| 'warning' \| 'info' \| 'error'; message: string }>` | Validation items |
| `packages` | `Array<{ registryType: string; identifier: string; runtimeHint: string }>?` | Available packages |
| `selectedPackageIndex` | `number` | Selected package |
| `envVars` | `Array<{ name: string; description?: string; required: boolean; value: string }>` | Environment variables |
| `serverName` | `string` | Override name |
| `onJsonChange` | `(content: string) => void` | JSON content change |
| `onValidate` | `() => void` | Re-validate |
| `onSelectPackage` | `(index: number) => void` | Select package |
| `onEnvVarChange` | `(name: string, value: string) => void` | Env var change |
| `onServerNameChange` | `(name: string) => void` | Name change |
| `onAddServer` | `() => void` | Add server |
| `onCancel` | `() => void` | Cancel |

**Mantine:** `Textarea` or `JsonInput` for JSON, `List` with icons for validation results, `Radio.Group` for package selection, `TextInput` fields for env vars (required marked), `TextInput` for name, action `Button` group.

**Stories:** Empty, ValidJson, InvalidJson, MultiplePackages, WithEnvVars, FullyConfigured

---

### 2.22 ExperimentalFeaturesPanel

Server/client experimental capabilities + raw JSON-RPC tester.

| Prop | Type | Description |
|------|------|-------------|
| `serverCapabilities` | `Array<{ name: string; description?: string; methods?: string[] }>` | Server experimental caps |
| `clientCapabilities` | `Array<{ name: string; enabled: boolean }>` | Client experimental caps |
| `requestJson` | `string` | JSON-RPC request editor content |
| `responseJson` | `string?` | JSON-RPC response |
| `customHeaders` | `Array<{ key: string; value: string }>` | Custom headers for request |
| `requestHistory` | `Array<{ timestamp: string; method: string; status: string; durationMs: number }>` | Request history |
| `onToggleClientCapability` | `(name: string, enabled: boolean) => void` | Toggle cap |
| `onRequestChange` | `(json: string) => void` | Request JSON change |
| `onSendRequest` | `() => void` | Send request |
| `onAddHeader` | `() => void` | Add header |
| `onRemoveHeader` | `(index: number) => void` | Remove header |
| `onHeaderChange` | `(index: number, key: string, value: string) => void` | Edit header |
| `onCopyResponse` | `() => void` | Copy response |

**Mantine:** `Stack` with `Alert` warning, server caps as `Card` list with Test buttons, `Checkbox` group for client caps, `Divider`, `JsonInput` for request/response, header key-value pairs, action `Button`, history `Table`.

**Stories:** WithServerCaps, NoServerCaps, WithResponse, WithHistory, WithCustomHeaders

---

### 2.23 InlineSamplingRequest

Compact inline sampling request shown during tool execution.

| Prop | Type | Description |
|------|------|-------------|
| `queuePosition` | `string` | e.g., "1 of 2" |
| `modelHints` | `string[]?` | Model hints |
| `messagePreview` | `string` | Truncated first message |
| `responseText` | `string` | Response text |
| `onAutoRespond` | `() => void` | Auto-respond |
| `onEditAndSend` | `() => void` | Edit & send |
| `onReject` | `() => void` | Reject |
| `onViewDetails` | `() => void` | Expand to full view |

**Mantine:** `Paper` with `Group` header (type badge + queue position), compact content, `Textarea` for response, action `Button` group.

**Stories:** Default, WithModelHints, PrefilledResponse, InQueue

---

### 2.24 InlineElicitationRequest

Compact inline elicitation (form or URL) shown during tool execution.

| Prop | Type | Description |
|------|------|-------------|
| `mode` | `'form' \| 'url'` | Elicitation mode |
| `message` | `string` | Server message |
| `queuePosition` | `string` | e.g., "2 of 2" |
| `schema` | `object?` | JSON Schema (form mode) |
| `values` | `Record<string, unknown>?` | Form values |
| `url` | `string?` | URL (url mode) |
| `isWaiting` | `boolean?` | Waiting state (url mode) |
| `onChange` | `(values: Record<string, unknown>) => void` | Form change |
| `onSubmit` | `() => void` | Submit/confirm |
| `onCancel` | `() => void` | Cancel |

**Mantine:** `Paper` with header badge, compact SchemaForm or URL display, action buttons.

**Stories:** FormMode, UrlMode, UrlWaiting

---

### 2.25 PendingClientRequests

Container for inline sampling/elicitation requests during tool execution.

| Prop | Type | Description |
|------|------|-------------|
| `count` | `number` | Total pending requests |
| `children` | `ReactNode` | InlineSamplingRequest and/or InlineElicitationRequest |

**Mantine:** `Alert` with count header, `Stack` of children.

**Stories:** SingleSampling, SingleElicitation, MultipleMixed

---

## Tier 3 - Screens

Full screen sections composed of groups. These are the main content areas.

### 3.1 ServerListScreen

Home screen with server card grid and add button.

| Prop | Type | Description |
|------|------|-------------|
| `servers` | `ServerCard props[]` | Array of server data |
| `onAddManually` | `() => void` | Add manually |
| `onImportConfig` | `() => void` | Import config |
| `onImportServerJson` | `() => void` | Import server.json |

**Mantine:** `Container` with `Title` "MCP Inspector" header, `Group` with AddServerMenu, `SimpleGrid` cols={{ base: 1, md: 2 }} of ServerCard components.

**Stories:** MultipleServers, SingleServer, Empty, MixedStates

---

### 3.2 ToolsScreen

Three-panel layout: tool list, detail/form, and results.

| Prop | Type | Description |
|------|------|-------------|
| `tools` | `ToolListItem props[]` | Tool list data |
| `selectedTool` | `ToolDetailPanel props?` | Selected tool details |
| `result` | `ResultPanel props?` | Execution result |
| `listChanged` | `boolean` | List changed indicator |
| `searchText` | `string` | Search filter |
| `pendingRequests` | `PendingClientRequests props?` | Inline client requests |
| `onSearchChange` | `(text: string) => void` | Search change |
| `onRefreshList` | `() => void` | Refresh tool list |
| `onSelectTool` | `(name: string) => void` | Select tool |
| (tool detail & result callbacks forwarded) | | |

**Mantine:** Three-column layout using `Grid` (col spans ~3/5/4 of 12) or CSS Grid. Left panel: ListChangedIndicator + `TextInput` search + ToolListItem stack. Center: ToolDetailPanel with PendingClientRequests below. Right: ResultPanel.

**Stories:** NoSelection, ToolSelected, WithResult, Executing, WithProgress, WithListChanged, WithPendingRequests, WithSearch

---

### 3.3 ResourcesScreen

Two-panel layout: resource list (with accordion sections) and content preview.

| Prop | Type | Description |
|------|------|-------------|
| `resources` | `ResourceListItem props[]` | Resources |
| `templates` | `ResourceTemplateInput props[]` | Templates |
| `subscriptions` | `Array<{ name: string; lastUpdated?: string }>` | Active subscriptions |
| `selectedResource` | `ResourcePreviewPanel props?` | Selected resource preview |
| `listChanged` | `boolean` | List changed indicator |
| `searchText` | `string` | Search filter |
| `onSearchChange` | `(text: string) => void` | Search change |
| `onRefreshList` | `() => void` | Refresh |
| `onSelectResource` | `(uri: string) => void` | Select resource |
| (preview callbacks forwarded) | | |

**Mantine:** Two-column `Grid`. Left: ListChangedIndicator, `TextInput` search, `Accordion` with Resources/Templates/Subscriptions sections. Right: ResourcePreviewPanel.

**Stories:** WithResources, WithTemplates, WithSubscriptions, ResourceSelected, Empty, WithListChanged

---

### 3.4 PromptsScreen

Two-panel layout: prompt selection/form and message results.

| Prop | Type | Description |
|------|------|-------------|
| `promptForm` | `PromptArgumentsForm props` | Left panel props |
| `messages` | `PromptMessagesDisplay props?` | Right panel props |
| `listChanged` | `boolean` | List changed indicator |
| `onRefreshList` | `() => void` | Refresh |

**Mantine:** Two-column `Grid`. Left: ListChangedIndicator + PromptArgumentsForm. Right: PromptMessagesDisplay.

**Stories:** NoSelection, PromptSelected, WithResult, WithListChanged, ManyArguments

---

### 3.5 LoggingScreen

Two-panel layout: controls and log stream.

| Prop | Type | Description |
|------|------|-------------|
| `controls` | `LogControls props` | Left panel controls |
| `entries` | `LogEntry props[]` | Log entries |
| `autoScroll` | `boolean` | Auto-scroll state |
| `onToggleAutoScroll` | `() => void` | Toggle auto-scroll |
| `onCopyAll` | `() => void` | Copy all logs |

**Mantine:** Two-column `Grid` (~3/9 split). Left: LogControls. Right: `Paper` with header (Auto-scroll `Checkbox` + Copy All `Button`), `ScrollArea` with LogEntry stack.

**Stories:** Empty, WithEntries, MixedLevels, FilteredView, ManyEntries

---

### 3.6 TasksScreen

Grouped task cards: active and completed sections.

| Prop | Type | Description |
|------|------|-------------|
| `activeTasks` | `TaskCard props[]` | Active/waiting tasks |
| `completedTasks` | `TaskCard props[]` | Completed/failed/cancelled tasks |
| `onRefresh` | `() => void` | Refresh tasks |
| `onClearHistory` | `() => void` | Clear completed tasks |

**Mantine:** `Stack` with `Title` + Refresh `Button`, "Active Tasks" section header + TaskCard list, "Completed Tasks" section header with Clear History `Button` + TaskCard list.

**Stories:** ActiveOnly, CompletedOnly, Mixed, Empty, ManyTasks

---

### 3.7 HistoryScreen

Request history list with search, filter, pinned section.

| Prop | Type | Description |
|------|------|-------------|
| `entries` | `HistoryEntry props[]` | History entries |
| `pinnedEntries` | `HistoryEntry props[]` | Pinned entries |
| `searchText` | `string` | Search filter |
| `methodFilter` | `string?` | Method type filter |
| `totalCount` | `number` | Total entries |
| `displayedCount` | `number` | Currently shown |
| `onSearchChange` | `(text: string) => void` | Search change |
| `onMethodFilterChange` | `(method: string) => void` | Filter change |
| `onClearAll` | `() => void` | Clear history |
| `onExport` | `() => void` | Export JSON |
| (entry callbacks forwarded) | | |

**Mantine:** `Paper` with header `Group` (Title + `TextInput` search + `Select` filter + Export `Button` + Clear `Button`), `Stack` of HistoryEntry, "Pinned Requests" `Divider` + pinned entries.

**Stories:** WithEntries, WithPinned, WithNestedChildren, Filtered, Empty, ManyEntries

---

## Tier 4 - Page Views

### 4.1 HomeLayout

Layout for the disconnected state (server list page).

| Prop | Type | Description |
|------|------|-------------|
| `children` | `ReactNode` | Page content (ServerListScreen) |
| `colorScheme` | `'light' \| 'dark'` | Theme |
| `onToggleTheme` | `() => void` | Theme toggle |

**Mantine:** `AppShell` with `AppShell.Header` containing "MCP Inspector" title + theme toggle `ActionIcon`. Body renders children.

**Stories:** Light, Dark

---

### 4.2 ConnectedLayout

Layout for connected state with navigation bar.

| Prop | Type | Description |
|------|------|-------------|
| `serverName` | `string` | Server name in header |
| `status` | `'connected' \| 'connecting' \| 'failed'` | Connection status |
| `latencyMs` | `number?` | Ping latency |
| `activeTab` | `string` | Currently active nav tab |
| `availableTabs` | `string[]` | Which tabs to show (based on capabilities) |
| `colorScheme` | `'light' \| 'dark'` | Theme |
| `onTabChange` | `(tab: string) => void` | Tab navigation |
| `onDisconnect` | `() => void` | Disconnect callback |
| `onToggleTheme` | `() => void` | Theme toggle |
| `children` | `ReactNode` | Screen content |

**Mantine:** `AppShell` with `AppShell.Header` containing server name `Menu` (dropdown), StatusIndicator, navigation `Tabs` (Tools, Resources, Prompts, Logs, Tasks, History), theme toggle, Disconnect `Button` (red outline). Body renders children.

**Stories:** ToolsActive, ResourcesActive, AllTabs, LimitedTabs, LongServerName

---

## Build Order

Components should be built bottom-up. Within each tier, components can be built in parallel. Dependencies are listed to show what must exist before a component can be composed.

### Phase 1: Foundation (Elements)
All Tier 1 elements can be built in parallel. No dependencies on each other.

1. StatusIndicator
2. AnnotationBadge
3. CapabilityItem
4. LogEntry
5. ProgressDisplay
6. ContentViewer
7. ListChangedIndicator
8. CopyButton
9. ConnectionToggle
10. TransportBadge
11. InlineError
12. MessageBubble

### Phase 2: Core Groups
Depends on Phase 1 elements being complete.

1. **SchemaForm** (2.12) - Critical path, used by many other groups
2. **ServerCard** (2.1) - Uses StatusIndicator, TransportBadge, ConnectionToggle, CopyButton, InlineError
3. **AddServerMenu** (2.2)
4. **ToolListItem** (2.3) - Uses AnnotationBadge
5. **ResourceListItem** (2.6) - Uses AnnotationBadge
6. **LogControls** (2.11)
7. **ResultPanel** (2.5) - Uses ContentViewer, CopyButton
8. **PromptMessagesDisplay** (2.10) - Uses MessageBubble
9. **RootsTable** (2.18)
10. **ServerInfoContent** (2.19) - Uses CapabilityItem

### Phase 3: Dependent Groups
Depends on SchemaForm and Phase 2.

1. **ToolDetailPanel** (2.4) - Uses SchemaForm, AnnotationBadge, ProgressDisplay
2. **ResourcePreviewPanel** (2.7) - Uses ContentViewer
3. **ResourceTemplateInput** (2.8)
4. **PromptArgumentsForm** (2.9)
5. **TaskCard** (2.13) - Uses ProgressDisplay
6. **HistoryEntry** (2.14)
7. **SamplingRequestPanel** (2.15) - Uses MessageBubble
8. **ElicitationFormPanel** (2.16) - Uses SchemaForm
9. **ElicitationUrlPanel** (2.17)
10. **ServerSettingsForm** (2.20)
11. **ImportServerJsonPanel** (2.21)
12. **ExperimentalFeaturesPanel** (2.22)

### Phase 4: Inline Handlers
Depends on Phase 3 panels.

1. **InlineSamplingRequest** (2.23)
2. **InlineElicitationRequest** (2.24) - Uses SchemaForm
3. **PendingClientRequests** (2.25) - Contains inline requests

### Phase 5: Screens (Screens)
Depends on all groups.

1. **ServerListScreen** (3.1)
2. **ToolsScreen** (3.2)
3. **ResourcesScreen** (3.3)
4. **PromptsScreen** (3.4)
5. **LoggingScreen** (3.5)
6. **TasksScreen** (3.6)
7. **HistoryScreen** (3.7)

### Phase 6: Views
Depends on screens.

1. **HomeLayout** (4.1)
2. **ConnectedLayout** (4.2)

---

## Storybook Configuration

### Global Setup

```typescript
// .storybook/preview.tsx
import { MantineProvider } from '@mantine/core';
import '@mantine/core/styles.css';
import { theme } from '../src/theme';

export const decorators = [
  (Story) => (
    <MantineProvider theme={theme}>
      <Story />
    </MantineProvider>
  ),
];

export const parameters = {
  layout: 'centered',       // elements/groups
  // layout: 'fullscreen',  // screens/views
};
```

### Addon Recommendations

| Addon | Purpose |
|-------|---------|
| `storybook-addon-mantine` | Theme switching, color scheme toggle |
| `@storybook/addon-actions` | Log callback invocations |
| `@storybook/addon-controls` | Interactive prop editing |
| `@storybook/addon-viewport` | Responsive testing |
| `@storybook/addon-a11y` | Accessibility checks |

### Theme Configuration

The Mantine theme should be defined once and shared between Storybook and the application:

```typescript
// src/theme.ts
import { createTheme } from '@mantine/core';

export const theme = createTheme({
  primaryColor: 'dark',
  // Inspector-specific overrides
});
```

### Dark Mode Stories

Every component should be verified in both light and dark mode. Use `storybook-addon-mantine` to provide a global toggle rather than duplicating stories.
