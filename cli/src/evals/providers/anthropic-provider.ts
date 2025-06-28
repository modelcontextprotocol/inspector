// Anthropic-specific LLM provider implementation
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Tool, ListToolsResult } from "@modelcontextprotocol/sdk/types.js";
import type {
  MessageParam,
  ToolUseBlockParam,
  ToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/messages";
import type {
  SingleEvalConfig,
  LlmJudgeResult,
  ToolCallResult,
} from "../types.js";
import type { LLMProvider } from "./llm-provider.js";

interface AnthropicTool {
  name: string;
  description: string;
  input_schema: any;
}

export class AnthropicProvider implements LLMProvider<MessageParam> {
  private client: Anthropic;

  constructor() {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY environment variable is required.\n" +
          "Please set your API key: export ANTHROPIC_API_KEY=your_api_key_here",
      );
    }

    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  async executeConversation(
    mcpClient: Client,
    prompt: string,
    config: SingleEvalConfig,
  ): Promise<MessageParam[]> {
    const tools = await this.getTools(mcpClient);
    let messages: MessageParam[] = [{ role: "user", content: prompt }];

    let currentStep = 0;
    while (currentStep < config.maxSteps) {
      const response = await this.client.messages.create({
        model: config.model,
        max_tokens: 1024,
        messages: messages,
        system:
          "You are an assistant that helps with tasks using the available tools. Use tools when appropriate to complete the user's request.",
        tools: tools.length > 0 ? tools : undefined,
      });

      // Add assistant response to conversation
      messages.push({
        role: "assistant",
        content: response.content,
      });

      // Process tool calls if any
      const toolResults = await this.processToolCalls(
        mcpClient,
        response.content,
      );

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

  async runLLMJudge(
    criteria: string,
    originalPrompt: string,
    conversation: string,
  ): Promise<LlmJudgeResult> {
    const systemMessage = `You are an expert evaluator of AI assistant conversations. Your task is to assess how well the assistant's response meets the specified eval criteria.

Evaluate the response considering:
- Does it directly address what was requested?
- Is the information accurate and helpful? 
- Does it fully satisfy the user's needs?
- Does it avoid providing information that is not relevant to the user's request?
- Does it avoid making tool calls that are not relevant to the user's request?

Rate the response on a scale of 0.0 to 1.0:
- 1.0 = Excellent, fully meets criteria
- 0.8 = Good, mostly meets criteria with minor gaps
- 0.6 = Acceptable, partially meets criteria  
- 0.4 = Poor, significant issues or gaps
- 0.2 = Inadequate, major problems
- 0.0 = Failed, does not meet criteria at all

Respond with valid JSON containing your numeric score and brief rationale.`;

    const userMessage = `ORIGINAL REQUEST:
${originalPrompt}

ASSISTANT'S RESPONSE:
${conversation}

EVAL CRITERIA:
${criteria}

Provide your assessment as JSON:
{"score": <number>, "rationale": "<explanation>"}`;

    const response = await this.client.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 250,
      system: systemMessage,
      messages: [
        {
          role: "user",
          content: userMessage,
        },
      ],
    });

    // Extract and parse JSON response
    const responseText =
      response.content[0]?.type === "text"
        ? response.content[0].text.trim()
        : "";

    try {
      const parsed = JSON.parse(responseText);
      const score = parseFloat(parsed.score);
      const rationale = parsed.rationale || "No rationale provided";

      if (isNaN(score) || score < 0 || score > 1) {
        throw new Error(`Invalid score: ${parsed.score}`);
      }

      return { score, rationale };
    } catch (error) {
      throw new Error(
        `Invalid JSON response from LLM judge: "${responseText}". Error: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }

  private async getTools(mcpClient: Client): Promise<AnthropicTool[]> {
    const mcpTools: ListToolsResult = await mcpClient.listTools();
    return this.convertToAnthropicFormat(mcpTools.tools);
  }

  private convertToAnthropicFormat(tools: Tool[]): AnthropicTool[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description || `Execute ${tool.name} tool`,
      input_schema: tool.inputSchema || { type: "object", properties: {} },
    }));
  }

  private async processToolCalls(
    mcpClient: Client,
    content: any[],
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
            const resultContent =
              toolResult.structuredContent || toolResult.content || [];
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: JSON.stringify(resultContent),
            });
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Tool execution failed";
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

  // Message parsing methods - move from message-parser.ts
  getAllAssistantText(messages: MessageParam[]): string {
    const assistantTexts: string[] = [];

    for (const message of messages) {
      if (message.role === "assistant") {
        if (typeof message.content === "string") {
          assistantTexts.push(message.content);
        } else if (Array.isArray(message.content)) {
          for (const content of message.content) {
            if (content.type === "text") {
              assistantTexts.push(content.text);
            }
          }
        }
      }
    }

    return assistantTexts.join(" ");
  }

  getOriginalPrompt(messages: MessageParam[]): string {
    const firstUserMessage = messages.find((msg) => msg.role === "user");
    if (firstUserMessage && typeof firstUserMessage.content === "string") {
      return firstUserMessage.content;
    }
    return "Unable to extract prompt";
  }

  extractToolCallResults(messages: MessageParam[]): ToolCallResult[] {
    // Map MCP request IDs to tool call results
    const toolUseMap = new Map<string, ToolCallResult>();

    for (const message of messages) {
      if (Array.isArray(message.content)) {
        for (const content of message.content) {
          // Collect tool uses (assistant messages)
          if (content.type === "tool_use" && message.role === "assistant") {
            const toolUse = content as ToolUseBlockParam;
            // Use MCP request ID as the key to match with results
            toolUseMap.set(toolUse.id, {
              name: toolUse.name,
              success: false, // Default to false until we find the result
              error: undefined,
            });
          }
          // Update with tool results (user messages)
          else if (content.type === "tool_result" && message.role === "user") {
            const toolResult = content as ToolResultBlockParam;
            // Match result to original request using MCP request ID
            const toolCall = toolUseMap.get(toolResult.tool_use_id);
            if (toolCall) {
              toolCall.success = !toolResult.is_error;
              if (
                toolResult.is_error &&
                typeof toolResult.content === "string"
              ) {
                // Clean up error message - extract text from JSON structure if present
                let errorMessage = toolResult.content;
                if (
                  errorMessage.startsWith('Error: [{"type":"text","text":"') &&
                  errorMessage.endsWith('"}]')
                ) {
                  // Extract just the text content from the JSON structure
                  try {
                    const parsed = JSON.parse(
                      errorMessage.replace("Error: ", ""),
                    );
                    if (
                      Array.isArray(parsed) &&
                      parsed[0]?.type === "text" &&
                      parsed[0]?.text
                    ) {
                      errorMessage = parsed[0].text;
                    }
                  } catch {
                    // If parsing fails, use the original message
                  }
                }
                toolCall.error = errorMessage;
              }
            }
          }
        }
      }
    }

    return Array.from(toolUseMap.values());
  }

  formatMessagesForLLM(messages: MessageParam[]): string {
    return messages
      .map((message) => {
        if (message.role === "user") {
          return `User: ${typeof message.content === "string" ? message.content : "[complex content]"}`;
        } else {
          // Extract text and tool calls from assistant message
          let result = "";
          if (Array.isArray(message.content)) {
            for (const content of message.content) {
              if (content.type === "text") {
                const textContent = content as any; // We know this is TextBlockParam
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
      })
      .join("\n\n");
  }
}
