import type { 
  MessageParam,
  TextBlockParam,
  ToolUseBlockParam,
  ToolResultBlockParam
} from "@anthropic-ai/sdk/resources/messages";

/**
 * Get all text content from assistant messages
 */
export function getAllAssistantText(messages: MessageParam[]): string {
  let output = "";
  
  for (const message of messages) {
    if (message.role === "assistant") {
      if (typeof message.content === "string") {
        output += message.content;
      } else if (Array.isArray(message.content)) {
        for (const content of message.content) {
          if (content.type === "text") {
            const textContent = content as TextBlockParam;
            output += textContent.text;
          }
        }
      }
    }
  }
  
  return output;
}

/**
 * Get the original prompt (first user message)
 */
export function getOriginalPrompt(messages: MessageParam[]): string {
  const firstMessage = messages[0];
  if (firstMessage?.role === "user" && typeof firstMessage.content === "string") {
    return firstMessage.content;
  }
  return "Unknown prompt";
}

/**
 * Format messages for display (no leading spaces)
 */
export function formatMessagesForDisplay(messages: MessageParam[]): string {
  return messages.map(message => formatMessage(message)).join('\n');
}

/**
 * Format a single message based on its role
 */
function formatMessage(message: MessageParam): string {
  switch (message.role) {
    case "user":
      return formatUserMessage(message);
    case "assistant":
      return formatAssistantMessage(message);
  }
}

/**
 * Format a user message
 */
function formatUserMessage(message: MessageParam): string {
  const steps: string[] = [];
  
  if (typeof message.content === "string") {
    steps.push(`User: "${message.content}"`);
  } else if (Array.isArray(message.content)) {
    // Handle tool results
    for (const content of message.content) {
      if (content.type === "tool_result") {
        const result = content as ToolResultBlockParam;
        if (result.is_error) {
          steps.push(`Tool result: ERROR`);
          steps.push(`  error: ${result.content}`);
        } else {
          steps.push(`Tool result: SUCCESS`);
          const responseString = formatParamsForDisplay(
            typeof result.content === "string" ? 
              tryParseJSON(result.content) : 
              result.content
          );
          steps.push(`  response: ${responseString}`);
        }
      }
    }
  }
  
  return steps.join('\n');
}

/**
 * Format an assistant message
 */
function formatAssistantMessage(message: MessageParam): string {
  const steps: string[] = [];
  
  if (typeof message.content === "string") {
    steps.push(`Assistant: "${message.content}"`);
  } else if (Array.isArray(message.content)) {
    for (const content of message.content) {
      if (content.type === "text") {
        const textContent = content as TextBlockParam;
        if (textContent.text.trim()) {
          steps.push(`Assistant: "${textContent.text.trim()}"`);
        }
      } else if (content.type === "tool_use") {
        const toolUse = content as ToolUseBlockParam;
        const paramsString = formatParamsForDisplay(toolUse.input as Record<string, any>);
        steps.push(`Tool call: ${toolUse.name}`);
        steps.push(`  params: ${paramsString}`);
      }
    }
  }
  
  return steps.join('\n');
}

/**
 * Extract tool call names from messages (for validation)
 */
export function extractToolCallNames(messages: MessageParam[]): string[] {
  const names: string[] = [];
  
  for (const message of messages) {
    if (message.role === "assistant" && Array.isArray(message.content)) {
      for (const content of message.content) {
        if (content.type === "tool_use") {
          const toolUse = content as ToolUseBlockParam;
          names.push(toolUse.name);
        }
      }
    }
  }
  
  return names;
}

function formatParamsForDisplay(params: Record<string, any>): string {
  const jsonString = JSON.stringify(params);
  
  // If the JSON is short, return it as-is
  if (jsonString.length <= 100) {
    return jsonString;
  }
  
  // Check if any values are likely base64 or very long strings
  const truncatedParams: Record<string, any> = {};
  
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') {
      // Truncate long strings (likely base64, file paths, etc.)
      if (value.length > 50) {
        truncatedParams[key] = `${value.substring(0, 47)}...`;
      } else {
        truncatedParams[key] = value;
      }
    } else if (typeof value === 'object' && value !== null) {
      // For objects, just show the structure
      truncatedParams[key] = Array.isArray(value) ? `[${value.length} items]` : '{...}';
    } else {
      truncatedParams[key] = value;
    }
  }
  
  return JSON.stringify(truncatedParams);
}

function tryParseJSON(str: string): any {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}