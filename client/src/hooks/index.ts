// MCP hooks exports

export { useMcpTools, type UseMcpToolsResult } from './useMcpTools';
export { useMcpResources, type UseMcpResourcesResult, type Subscription } from './useMcpResources';
export { useMcpPrompts, type UseMcpPromptsResult } from './useMcpPrompts';

// Sampling and elicitation handlers for inline queue
export { useSamplingHandler, type UseSamplingHandlerResult } from './useSamplingHandler';
export { useElicitationHandler, type UseElicitationHandlerResult } from './useElicitationHandler';

// NOTE: Tracked hooks (with history/logging) will be added when storage contexts
// (HistoryContext, LogsContext) are implemented per issue #983.
