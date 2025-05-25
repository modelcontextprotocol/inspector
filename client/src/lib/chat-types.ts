export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export interface ToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
  status?: "pending" | "success" | "error";
  result?: any;
}

export interface ToolResult {
  content: any;
  isError: boolean;
}

export interface ChatState {
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;
}

export interface OpenAIFunction {
  name: string;
  description?: string;
  parameters: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
}
