// MCP hooks exports
// NOTE: Tracked hooks (with history/logging) and sampling/elicitation handlers
// will be added in PR #3 when storage contexts are available.

export { useMcpTools, type UseMcpToolsResult } from './useMcpTools';
export { useMcpResources, type UseMcpResourcesResult, type Subscription } from './useMcpResources';
export { useMcpPrompts, type UseMcpPromptsResult } from './useMcpPrompts';
