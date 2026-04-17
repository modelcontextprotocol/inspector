# Phase 0.4 — Inventory of local re-declarations to delete

This checklist enumerates every ad hoc local type in `clients/web/src/` that
will be replaced during Phases 1–4 with a schema type from
`@modelcontextprotocol/sdk/types.js` or a wrapper type from
`core/mcp/types.ts`. Generated at the close of Phase 0; intended for the
Phase 0 PR description and as a running checklist during the refactor.

**Definition of done for each row**: the listed declaration is gone from
`clients/web/src/` and every import site references the replacement type.

## Local types → replacement

| Local type | Declared in | Also imported by | Replace with |
| --- | --- | --- | --- |
| `JsonSchema` | `groups/SchemaForm/SchemaForm.tsx` | `groups/InlineElicitationRequest/InlineElicitationRequest.tsx`, `groups/ElicitationFormPanel/ElicitationFormPanel.tsx`, `groups/ToolDetailPanel/ToolDetailPanel.tsx` | `JsonSchemaType` from `clients/web/src/utils/jsonUtils.ts` |
| `LogLevel` | `elements/LogEntry/LogEntry.tsx` | `elements/LogLevelBadge/LogLevelBadge.tsx`, `groups/LogStreamPanel/LogStreamPanel.stories.tsx`, `screens/LoggingScreen/LoggingScreen.stories.tsx`, `views/ConnectedView/ConnectedView.stories.tsx` | SDK `LoggingLevel` |
| `TaskStatus` | `groups/TaskCard/TaskCard.tsx` | `elements/TaskStatusBadge/TaskStatusBadge.tsx`, `groups/TaskControls/TaskControls.tsx` | `Task["status"]` from SDK |
| `PromptItem`, `SelectedPrompt` | `screens/PromptsScreen/PromptsScreen.tsx` | `groups/PromptControls/PromptControls.tsx`, `screens/PromptsScreen/PromptsScreen.stories.tsx` | SDK `Prompt` (plus `GetPromptResult` for `SelectedPrompt`) |
| `ResourceItem`, `TemplateListItem`, `SubscriptionItem` | `screens/ResourcesScreen/ResourcesScreen.tsx` | `groups/ResourceControls/ResourceControls.tsx`, `screens/ResourcesScreen/ResourcesScreen.stories.tsx` | SDK `Resource`, `ResourceTemplate`, wrapper `InspectorResourceSubscription` from `core/mcp/types.ts` |
| `ToolListItemProps` (as a data shape) | `groups/ToolListItem/ToolListItem.tsx` | `groups/ToolControls/ToolControls.tsx`, `screens/ToolsScreen/ToolsScreen.tsx`, `screens/ToolsScreen/ToolsScreen.stories.tsx` | SDK `Tool` |
| `RootEntry` | `groups/RootsTable/RootsTable.tsx` | — | SDK `Root` |
| `KeyValuePair` | `groups/ServerSettingsForm/ServerSettingsForm.tsx`, `groups/ExperimentalFeaturesPanel/ExperimentalFeaturesPanel.tsx` | — | `CustomHeader` from `clients/web/src/lib/types/customHeaders.ts` when the form edits headers specifically; keep a local `KeyValuePair` only for generic key/value lists (e.g. metadata) |
| inline `"connected" \| "connecting" \| "disconnected" \| "failed"` | `elements/ServerStatusIndicator/ServerStatusIndicator.tsx:4`, `groups/ServerCard/ServerCard.tsx:15`, `views/ConnectedView/ConnectedView.tsx:7` | — | `ConnectionStatus` from `core/mcp/types.ts`. **Note**: reconcile `"failed"` → `"error"` (v1.5's canonical spelling) |
| inline `"stdio" \| "http"` transport union | `elements/TransportBadge/TransportBadge.tsx:4`, `groups/ServerCard/ServerCard.tsx:12` plus story fixtures | — | `ServerType` (`"stdio" \| "sse" \| "streamable-http"`) from `core/mcp/types.ts` |

## Validation

After Phase 1 + Phase 2 complete, this must return zero matches:

```sh
git grep -nE '\b(JsonSchema|LogLevel|TaskStatus|PromptItem|SelectedPrompt|ResourceItem|TemplateListItem|SubscriptionItem|ToolListItemProps|RootEntry)\b' clients/web/src
```

And the inline unions above must no longer appear in the listed files.
