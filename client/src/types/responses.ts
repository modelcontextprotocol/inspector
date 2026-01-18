/**
 * Shared response types for MCP client features
 * Per MCP 2025-11-25 specification
 */

// Tool definition for sampling requests
export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

// Tool call in sampling response
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

// Tool choice options
export type ToolChoice =
  | { type: 'auto' }
  | { type: 'none' }
  | { type: 'required' }
  | { type: 'tool'; name: string };

// Sampling response content
export type SamplingContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

// Stop reason for sampling response
export type StopReason = 'endTurn' | 'stopSequence' | 'maxTokens' | 'toolUse';

// Sampling response sent back to server
export interface SamplingResponse {
  content: SamplingContent;
  model: string;
  stopReason: StopReason;
  toolCalls?: ToolCall[];
}

// Elicitation response action
export type ElicitationAction = 'accept' | 'decline' | 'cancel';

// Elicitation response sent back to server
export interface ElicitationResponse {
  action: ElicitationAction;
  data?: Record<string, unknown>;
}

// Request info for logs correlation
export interface RequestInfo {
  id: string;
  method: string;
  target?: string;
  timestamp: string;
}
