import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { listTools, callTool } from "../client/index.js";
import Anthropic from "@anthropic-ai/sdk";
import type { 
  MessageParam,
  Message,
  ContentBlock,
  TextBlock,
  ToolUseBlock,
  TextBlockParam,
  ToolUseBlockParam,
  ToolResultBlockParam
} from "@anthropic-ai/sdk/resources/messages";
import AjvLib from "ajv";
const Ajv = AjvLib.default || AjvLib;
import fs from "node:fs";
import path from "node:path";
import { type EvalConfig, validateEvalConfig } from "./schema.js";

interface ExtractedToolCall {
  name: string;
  args: Record<string, any>;
  result?: any;
  error?: string;
  success: boolean;
}

interface ScorerResult {
  passed: boolean;
  error?: string;
  judgeRationale?: string;
}

interface EvalDetails {
  toolCallsExecuted: ExtractedToolCall[];
  output: string;
  conversationSteps: string[];
  validationErrors: string[];
  scorerResults?: ScorerResult[];
}

export interface EvalResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: EvalDetails;
}

export class EvalEngine {
  private client: Client;
  private anthropic: Anthropic;
  private ajv: any;

  constructor(client: Client) {
    this.client = client;

    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY environment variable is required for evaluation mode.\n" +
          "Please set your API key: export ANTHROPIC_API_KEY=your_api_key_here",
      );
    }

    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    this.ajv = new Ajv();
  }

  async runEvals(configPath: string): Promise<EvalResult[]> {
    const config = this.loadConfig(configPath);
    const results: EvalResult[] = [];

    console.log(`Running ${config.evals.length} eval tests...\n`);

    for (const evalTest of config.evals) {
      try {
        const result = await this.runSingleEval(evalTest, config);
        results.push(result);

        if (result.passed) {
          console.log(`✅ ${evalTest.name}: PASSED`);
        } else {
          console.log(`❌ ${evalTest.name}: FAILED`);
          console.log(`   Prompt: "${evalTest.prompt}"`);

          // Format errors with better readability
          if (result.error) {
            console.log(`   Errors:`);
            const errors = result.error.split("; ");
            errors.forEach((error, index) => {
              console.log(`     • ${error}`);
              
              // Show LLM judge rationale if available
              const scorerResult = result.details?.scorerResults?.[index];
              if (scorerResult?.judgeRationale) {
                console.log(`       Rationale: ${scorerResult.judgeRationale}`);
              }
            });
          }

          if (
            result.details?.conversationSteps &&
            result.details.conversationSteps.length > 0
          ) {
            console.log(`   Conversation:`);
            result.details.conversationSteps.forEach((step) => {
              // Add extra indentation for multi-line assistant messages
              if (step.includes("Assistant:") && step.includes("\n")) {
                const lines = step.split("\n");
                console.log(`     ${lines[0]}`);
                lines.slice(1).forEach((line) => {
                  if (line.trim()) {
                    console.log(`       ${line.trim()}`);
                  }
                });
              } else {
                console.log(`     ${step}`);
              }
            });
          }
        }
      } catch (error) {
        const errorResult: EvalResult = {
          name: evalTest.name,
          passed: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
        results.push(errorResult);
        console.log(`❌ ${evalTest.name}: ERROR - ${errorResult.error}`);
      }
    }

    console.log(
      `\nResults: ${results.filter((r) => r.passed).length}/${results.length} tests passed`,
    );
    return results;
  }

  private loadConfig(configPath: string): EvalConfig {
    const resolvedPath = path.isAbsolute(configPath)
      ? configPath
      : path.resolve(process.cwd(), configPath);

    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Eval config file not found: ${resolvedPath}`);
    }

    const content = fs.readFileSync(resolvedPath, "utf8");
    let config: unknown;

    try {
      config = JSON.parse(content);
    } catch (error) {
      throw new Error(
        `Invalid JSON in eval config file: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }

    // Validate the config
    const validation = validateEvalConfig(config);
    if (!validation.valid) {
      let errorMessage = `Invalid evaluation configuration format in: ${resolvedPath}\n\n`;

      if (validation.errors && validation.errors.length > 0) {
        errorMessage += "Validation errors:\n";
        validation.errors.forEach((error) => {
          errorMessage += `  • ${error}\n`;
        });
        errorMessage += "\n";
      }

      // Show sample configuration
      errorMessage +=
        "For a valid configuration example, see sample-evals.json in the inspector directory.\n";

      throw new Error(errorMessage);
    }

    return config as EvalConfig;
  }

  private async runSingleEval(
    evalTest: EvalConfig["evals"][0],
    globalConfig: EvalConfig,
  ): Promise<EvalResult> {
    // Get config (global config with defaults)
    const config = {
      model: globalConfig.config?.model || "claude-3-haiku-20240307",
      maxSteps: globalConfig.config?.maxSteps || 3,
      timeout: globalConfig.config?.timeout || 30000,
      systemPrompt:
        "You are an assistant that helps with tasks using the available tools. Use tools when appropriate to complete the user's request.",
    };

    // Run the conversation
    const messages = await this.buildConversation(evalTest.prompt, config);

    // Extract tool calls for validation
    const toolCalls = this.extractToolCalls(messages);

    // Validate expected tool calls
    const toolValidationErrors = this.validateExpectedToolCalls(evalTest.expectedToolCalls, toolCalls);

    // Run response scorers
    const scorerResults = await this.runResponseScorers(evalTest.responseScorers, messages);

    // Combine all errors
    const allErrors = [
      ...toolValidationErrors,
      ...scorerResults.filter(r => !r.passed).map((r, i) => 
        `Output scorer ${i + 1} (${evalTest.responseScorers[i]?.type}) failed: ${r.error || 'Unknown error'}`
      )
    ];

    return {
      name: evalTest.name,
      passed: allErrors.length === 0,
      error: allErrors.length > 0 ? allErrors.join("; ") : undefined,
      details: {
        toolCallsExecuted: toolCalls,
        output: this.extractAssistantOutput(messages),
        conversationSteps: this.formatConversationForDisplay(messages),
        validationErrors: allErrors,
        scorerResults,
      },
    };
  }

  private async buildConversation(
    prompt: string,
    config: { model: string; maxSteps: number; systemPrompt: string }
  ): Promise<MessageParam[]> {
    // Get available tools and convert them
    const mcpTools = await listTools(this.client);
    const tools = this.convertMCPToolsToAnthropicFormat(
      (mcpTools as any).tools || [],
    );

    // Start conversation
    const messages: MessageParam[] = [
      {
        role: "user",
        content: prompt,
      },
    ];

    let currentStep = 0;
    const maxSteps = config.maxSteps;

    while (currentStep < maxSteps) {
      const message = await this.anthropic.messages.create({
        model: config.model,
        max_tokens: 1024,
        messages: messages,
        system: config.systemPrompt,
        tools: tools.length > 0 ? tools : undefined,
      });

      // Add assistant response to conversation
      messages.push({
        role: "assistant",
        content: message.content,
      });

      // Process tool calls and execute them
      let hasToolCalls = false;
      const toolResults: ToolResultBlockParam[] = [];

      for (const content of message.content) {
        if (content.type === "tool_use") {
          hasToolCalls = true;
          
          try {
            const toolInput = (content.input as Record<string, any>) || {};
            const toolResult = await callTool(
              this.client,
              content.name,
              toolInput,
            );

            toolResults.push({
              type: "tool_result",
              tool_use_id: content.id,
              content: JSON.stringify(toolResult),
            });
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Tool execution failed";
            toolResults.push({
              type: "tool_result",
              tool_use_id: content.id,
              content: `Error: ${errorMessage}`,
              is_error: true,
            });
          }
        }
      }

      // If no tool calls, we're done
      if (!hasToolCalls) {
        break;
      }

      // Add tool results to conversation
      if (toolResults.length > 0) {
        messages.push({
          role: "user",
          content: toolResults,
        });
      }

      currentStep++;
    }

    return messages;
  }

  private validateExpectedToolCalls(
    expectedToolCalls: EvalConfig["evals"][0]["expectedToolCalls"],
    toolCalls: ExtractedToolCall[]
  ): string[] {
    const errors: string[] = [];
    
    if (!expectedToolCalls) {
      return errors;
    }

    // Check required tools
    if (expectedToolCalls.required) {
      for (const requiredTool of expectedToolCalls.required) {
        const wasExecuted = toolCalls.some(call => call.name === requiredTool);
        if (!wasExecuted) {
          errors.push(`Required tool '${requiredTool}' was not called`);
        }
      }
    }

    // Check prohibited tools
    if (expectedToolCalls.prohibited) {
      for (const prohibitedTool of expectedToolCalls.prohibited) {
        const wasExecuted = toolCalls.some(call => call.name === prohibitedTool);
        if (wasExecuted) {
          errors.push(`Prohibited tool '${prohibitedTool}' was called`);
        }
      }
    }

    // Check that all executed tools are either required or allowed
    const allowedTools = new Set([
      ...(expectedToolCalls.required || []),
      ...(expectedToolCalls.allowed || []),
    ]);

    if (allowedTools.size > 0) {
      for (const toolCall of toolCalls) {
        if (!allowedTools.has(toolCall.name)) {
          errors.push(
            `Unexpected tool '${toolCall.name}' was called (not in required or allowed list)`
          );
        }
      }
    }

    return errors;
  }

  private async runResponseScorers(
    responseScorers: EvalConfig["evals"][0]["responseScorers"],
    messages: MessageParam[]
  ): Promise<ScorerResult[]> {
    const results: ScorerResult[] = [];
    
    for (const scorer of responseScorers) {
      try {
        const result = await this.runScorer(scorer, messages);
        results.push(result);
      } catch (error) {
        results.push({ 
          passed: false, 
          error: error instanceof Error ? error.message : "Unknown error" 
        });
      }
    }

    return results;
  }

  private extractToolCalls(messages: MessageParam[]): ExtractedToolCall[] {
    const toolCalls: ExtractedToolCall[] = [];
    
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      if (message?.role === "assistant" && Array.isArray(message.content)) {
        for (const content of message.content) {
          if (content.type === "tool_use") {
            const toolUse = content as ToolUseBlockParam;
            
            // Find the corresponding tool result
            let result: any = undefined;
            let error: string | undefined = undefined;
            let success = false;
            
            // Look for tool result in the next user message
            if (i + 1 < messages.length) {
              const nextMessage = messages[i + 1];
              if (nextMessage?.role === "user" && Array.isArray(nextMessage.content)) {
                for (const nextContent of nextMessage.content) {
                  if (nextContent.type === "tool_result" && nextContent.tool_use_id === toolUse.id) {
                    const toolResult = nextContent as ToolResultBlockParam;
                    if (toolResult.is_error) {
                      error = typeof toolResult.content === "string" ? toolResult.content : "Tool execution failed";
                      success = false;
                    } else {
                      try {
                        result = typeof toolResult.content === "string" ? JSON.parse(toolResult.content) : toolResult.content;
                        success = true;
                      } catch {
                        result = toolResult.content;
                        success = true;
                      }
                    }
                    break;
                  }
                }
              }
            }
            
            toolCalls.push({
              name: toolUse.name,
              args: toolUse.input as Record<string, any>,
              result,
              error,
              success,
            });
          }
        }
      }
    }
    
    return toolCalls;
  }

  private extractAssistantOutput(messages: MessageParam[]): string {
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

  private formatConversationForDisplay(messages: MessageParam[]): string[] {
    const steps: string[] = [];
    const allToolCalls = this.extractToolCalls(messages);
    
    let toolCallIndex = 0;
    
    for (const message of messages) {
      if (message.role === "user") {
        // Check if this is the initial prompt or tool results
        if (typeof message.content === "string") {
          steps.push(`  User: "${message.content}"`);
        }
        // Tool results are handled when processing the corresponding tool calls
      } else if (message.role === "assistant") {
        if (typeof message.content === "string") {
          steps.push(`  Assistant: "${message.content}"`);
        } else if (Array.isArray(message.content)) {
          for (const content of message.content) {
            if (content.type === "text") {
              const textContent = content as TextBlockParam;
              if (textContent.text.trim()) {
                steps.push(`  Assistant: "${textContent.text.trim()}"`);
              }
            } else if (content.type === "tool_use") {
              const toolUse = content as ToolUseBlockParam;
              const paramsString = this.formatParamsForDisplay(toolUse.input as Record<string, any>);
              steps.push(`  Tool call: ${toolUse.name}`);
              steps.push(`    params: ${paramsString}`);
              
              // Find the corresponding tool result from our extracted calls
              const toolCall = allToolCalls.find(call => 
                call.name === toolUse.name && 
                JSON.stringify(call.args) === JSON.stringify(toolUse.input)
              );
              
              if (toolCall) {
                if (toolCall.success) {
                  steps.push(`  Tool result: SUCCESS`);
                  const responseString = this.formatParamsForDisplay(toolCall.result);
                  steps.push(`    response: ${responseString}`);
                } else {
                  steps.push(`  Tool result: ERROR`);
                  steps.push(`    error: ${toolCall.error}`);
                }
                toolCallIndex++;
              }
            }
          }
        }
      }
    }
    
    return steps;
  }


  private async runScorer(
    scorer: EvalConfig["evals"][0]["responseScorers"][0],
    messages: MessageParam[]
  ): Promise<ScorerResult> {
    switch (scorer.type) {
      case "json-schema":
        if (!scorer.schema) {
          return {
            passed: false,
            error: "No schema provided for json-schema scorer",
          };
        }
        const output = this.extractAssistantOutput(messages);
        const isValid = this.ajv.validate(scorer.schema, output);
        if (!isValid) {
          return {
            passed: false,
            error: this.ajv.errorsText() || "Schema validation failed",
          };
        }
        return { passed: true };

      case "regex":
        if (!scorer.pattern) {
          return {
            passed: false,
            error: "No pattern provided for regex scorer",
          };
        }
        try {
          const output = this.extractAssistantOutput(messages);
          const regex = new RegExp(scorer.pattern, "i");
          const matches = regex.test(output);
          if (!matches) {
            return {
              passed: false,
              error: `Output does not match pattern: ${scorer.pattern}`,
            };
          }
          return { passed: true };
        } catch (error) {
          return {
            passed: false,
            error: `Invalid regex pattern: ${error instanceof Error ? error.message : "Unknown error"}`,
          };
        }

      case "llm-judge":
        if (!scorer.criteria) {
          return { passed: false, error: "No criteria provided for llm-judge scorer" };
        }
        
        try {
          const conversation = this.formatConversationForJudge(messages);
          const originalPrompt = this.extractOriginalPrompt(messages);
          const judgeResult = await this.runLLMJudge(scorer.criteria, originalPrompt, conversation);
          const threshold = scorer.threshold || 0.8;
          
          if (judgeResult.score < threshold) {
            return { 
              passed: false, 
              error: `LLM judge score ${judgeResult.score.toFixed(2)} below threshold ${threshold}`,
              judgeRationale: judgeResult.rationale
            };
          }
          return { passed: true };
        } catch (error) {
          return { passed: false, error: `LLM judge error: ${error instanceof Error ? error.message : "Unknown error"}` };
        }

      default:
        return {
          passed: false,
          error: `Unknown scorer type: ${(scorer as any).type}`,
        };
    }
  }

  private convertMCPToolsToAnthropicFormat(mcpTools: any[]): any[] {
    return mcpTools.map((tool) => ({
      name: tool.name,
      description: tool.description || `Execute ${tool.name} tool`,
      input_schema: tool.inputSchema || { type: "object", properties: {} },
    }));
  }

  private extractOriginalPrompt(messages: MessageParam[]): string {
    const firstMessage = messages[0];
    if (firstMessage?.role === "user" && typeof firstMessage.content === "string") {
      return firstMessage.content;
    }
    return "Unknown prompt";
  }

  private formatConversationForJudge(messages: MessageParam[]): string {
    const conversationSteps = this.formatConversationForDisplay(messages);
    return conversationSteps.join('\n');
  }

  private formatParamsForDisplay(params: Record<string, any>): string {
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

  private async runLLMJudge(criteria: string, originalPrompt: string, conversation: string): Promise<{ score: number; rationale: string }> {
    const systemMessage = `You are an expert evaluator of AI assistant conversations. You will be given a conversation between a user and an AI assistant, along with evaluation criteria.

Your task is to determine how well the assistant met the specified criteria. Provide a score between 0.0 and 1.0, where:
- 1.0 = Criteria fully met, excellent performance
- 0.8 = Criteria mostly met, good performance  
- 0.6 = Criteria partially met, acceptable performance
- 0.4 = Criteria poorly met, significant issues
- 0.2 = Criteria barely met, major problems
- 0.0 = Criteria not met at all, complete failure`;

    const userMessage = `CONVERSATION:
${conversation}

ORIGINAL REQUEST: 
${originalPrompt}

EVALUATION CRITERIA:
${criteria}

Respond with valid JSON:
{"score": <number 0.0-1.0>, "rationale": "<explanation>"}`;

    const response = await this.anthropic.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 200,
      system: systemMessage,
      messages: [
        {
          role: "user",
          content: userMessage,
        },
      ],
    });

    // Extract and parse JSON response
    const responseText = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
    
    try {
      const parsed = JSON.parse(responseText);
      const score = parseFloat(parsed.score);
      const rationale = parsed.rationale || "No rationale provided";
      
      if (isNaN(score) || score < 0 || score > 1) {
        throw new Error(`Invalid score: ${parsed.score}`);
      }
      
      return { score, rationale };
    } catch (error) {
      throw new Error(`Invalid JSON response from LLM judge: "${responseText}". Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

export async function runEvals(
  client: Client,
  configPath: string,
): Promise<void> {
  const engine = new EvalEngine(client);
  await engine.runEvals(configPath);
}
