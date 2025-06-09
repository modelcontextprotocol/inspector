import { ToolCallInfo } from "@/components/ToolCallMessage";

export interface ParsedContent {
  text: string;
  toolCalls: ToolCallInfo[];
}

// Parse tool call messages from content
export const parseToolCallContent = (content: string): ParsedContent => {
  const toolCalls: ToolCallInfo[] = [];
  let cleanText = content;

  // Pattern for tool calls: [Calling tool TOOL_NAME with args ARGS]
  const toolCallPattern = /\[Calling tool (\w+) with args (.*?)\]/g;
  let match;
  while ((match = toolCallPattern.exec(content)) !== null) {
    const [fullMatch, toolName, argsStr] = match;
    try {
      const args = JSON.parse(argsStr);
      toolCalls.push({
        type: "tool_call",
        toolName,
        args,
      });
    } catch {
      toolCalls.push({
        type: "tool_call",
        toolName,
        args: argsStr,
      });
    }
    cleanText = cleanText.replace(fullMatch, "").trim();
  }

  // Pattern for tool errors: [Tool TOOL_NAME failed: ERROR]
  // Handle complex multi-line errors with nested structures
  const toolErrorPattern =
    /\[Tool (\w+) failed: ([\s\S]*?)\](?=\s*(?:\n|$|\[(?:Tool|Warning|Calling)))/g;
  while ((match = toolErrorPattern.exec(content)) !== null) {
    const [fullMatch, toolName, error] = match;
    toolCalls.push({
      type: "tool_error",
      toolName,
      error: error.trim(),
    });
    cleanText = cleanText.replace(fullMatch, "").trim();
  }

  // Pattern for warnings: [Warning: MESSAGE]
  const warningPattern = /\[Warning: (.*?)\]/g;
  while ((match = warningPattern.exec(content)) !== null) {
    const [fullMatch, message] = match;
    toolCalls.push({
      type: "tool_warning",
      toolName: "system",
      message,
    });
    cleanText = cleanText.replace(fullMatch, "").trim();
  }

  return {
    text: cleanText,
    toolCalls,
  };
};
