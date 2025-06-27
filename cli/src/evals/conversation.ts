import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Tool, ListToolsResult } from "@modelcontextprotocol/sdk/types.js";
import Anthropic from "@anthropic-ai/sdk";
import type { 
  MessageParam,
  ToolUseBlockParam,
  ToolResultBlockParam
} from "@anthropic-ai/sdk/resources/messages";
import type { ConversationConfig } from "./types.js";

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: any;
}

export async function executeConversation(
  mcpClient: Client,
  anthropicClient: Anthropic,
  prompt: string,
  config: ConversationConfig
): Promise<MessageParam[]> {
  const tools = await getTools(mcpClient);
  let messages: MessageParam[] = [{ role: "user", content: prompt }];
  
  let currentStep = 0;
  while (currentStep < config.maxSteps) {
    const response = await anthropicClient.messages.create({
      model: config.model,
      max_tokens: 1024,
      messages: messages,
      system: "You are an assistant that helps with tasks using the available tools. Use tools when appropriate to complete the user's request.",
      tools: tools.length > 0 ? tools : undefined,
    });

    // Add assistant response to conversation
    messages.push({
      role: "assistant",
      content: response.content,
    });

    // Process tool calls if any
    const toolResults = await processToolCalls(mcpClient, response.content);
    
    if (toolResults.length === 0) {
      break; // No tool calls, conversation is done
    }

    // Add tool results to conversation
    messages.push({
      role: "user",
      content: toolResults,
    });

    currentStep++;
  }
  
  return messages;
}

async function getTools(mcpClient: Client): Promise<AnthropicTool[]> {
  const mcpTools: ListToolsResult = await mcpClient.listTools();
  return convertToAnthropicFormat(mcpTools.tools);
}

function convertToAnthropicFormat(tools: Tool[]): AnthropicTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description || `Execute ${tool.name} tool`,
    input_schema: tool.inputSchema || { type: "object", properties: {} },
  }));
}

async function processToolCalls(
  mcpClient: Client,
  content: any[]
): Promise<ToolResultBlockParam[]> {
  const toolResults: ToolResultBlockParam[] = [];
  
  for (const item of content) {
    if (item.type === "tool_use") {
      const toolUse = item as ToolUseBlockParam;
      
      try {
        const toolInput = (toolUse.input as Record<string, any>) || {};
        const toolResult = await mcpClient.callTool({
          name: toolUse.name,
          arguments: toolInput,
        });

        if (toolResult.isError) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: `Error: ${JSON.stringify(toolResult.content)}`,
            is_error: true,
          });
        } else {
          // Handle both structured content and regular content
          const resultContent = toolResult.structuredContent || toolResult.content || [];
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify(resultContent),
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Tool execution failed";
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: `Error: ${errorMessage}`,
          is_error: true,
        });
      }
    }
  }
  
  return toolResults;
}