import type { 
  MessageParam,
  TextBlockParam,
  ToolUseBlockParam
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
/**
 * Simple formatting function for LLM judge consumption
 * Provides basic conversation context without complex display formatting
 */
export function formatMessagesForLLM(messages: MessageParam[]): string {
  return messages.map(message => {
    if (message.role === "user") {
      return `User: ${typeof message.content === "string" ? message.content : "[complex content]"}`;  
    } else {
      // Extract text and tool calls from assistant message
      let result = "";
      if (Array.isArray(message.content)) {
        for (const content of message.content) {
          if (content.type === "text") {
            const textContent = content as TextBlockParam;
            result += `Assistant: ${textContent.text}\n`;
          } else if (content.type === "tool_use") {
            const toolUse = content as ToolUseBlockParam;
            result += `Tool called: ${toolUse.name}\n`;
          }
        }
      } else if (typeof message.content === "string") {
        result = `Assistant: ${message.content}\n`;
      }
      return result.trim();
    }
  }).join('\n\n');
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

