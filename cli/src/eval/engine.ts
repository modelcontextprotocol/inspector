import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { listTools, callTool } from "../client/index.js";
import Anthropic from "@anthropic-ai/sdk";
import AjvLib from "ajv";
const Ajv = AjvLib.default || AjvLib;
import fs from "node:fs";
import path from "node:path";
import { type EvalConfig, validateEvalConfig } from "./schema.js";

export interface EvalResult {
  name: string;
  passed: boolean;
  error?: string;
  details?: {
    toolCallsExecuted: Array<{ name: string; args: any }>;
    output: string;
    conversationSteps: string[];
    validationErrors: string[];
  };
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
            errors.forEach((error) => {
              console.log(`     • ${error}`);
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

    // Get available tools and convert them
    const mcpTools = await listTools(this.client);
    const tools = this.convertMCPToolsToAnthropicFormat(
      (mcpTools as any).tools || [],
    );

    // Track tool calls
    const executedTools: Array<{ name: string; args: any }> = [];

    // Multi-turn conversation to get complete LLM response
    const messages: any[] = [
      {
        role: "user",
        content: evalTest.prompt,
      },
    ];

    let output = "";
    const conversationSteps: string[] = [`  User: "${evalTest.prompt}"`];
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

      // Process the response in order (text and tool calls as they appear)
      let hasToolCalls = false;
      const toolResults: any[] = [];

      for (const content of message.content) {
        if (content.type === "text") {
          output += content.text;
          if (content.text.trim()) {
            conversationSteps.push(`  Assistant: "${content.text.trim()}"`);
          }
        } else if (content.type === "tool_use") {
          hasToolCalls = true;

          // Execute the tool
          let toolStatus = "";
          try {
            const toolInput = (content.input as Record<string, string>) || {};
            const toolResult = await callTool(
              this.client,
              content.name,
              toolInput,
            );
            executedTools.push({ name: content.name, args: toolInput });
            toolStatus = "[SUCCESS]";

            toolResults.push({
              type: "tool_result",
              tool_use_id: content.id,
              content: JSON.stringify(toolResult),
            });
          } catch (error) {
            // Tool execution failed, but we still track the attempt
            const toolInput = (content.input as Record<string, string>) || {};
            executedTools.push({ name: content.name, args: toolInput });
            const errorMessage =
              error instanceof Error ? error.message : "Tool execution failed";
            toolStatus = `[ERROR: ${errorMessage}]`;

            toolResults.push({
              type: "tool_result",
              tool_use_id: content.id,
              content: `Error: ${errorMessage}`,
            });
          }

          // Add tool call to conversation steps in order
          conversationSteps.push(`  Tool: ${content.name}() ${toolStatus}`);
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

    // Validate expectations
    const validationErrors: string[] = [];

    // Validate tool calls
    if (evalTest.expectedToolCalls) {
      // Check required tools
      if (evalTest.expectedToolCalls.required) {
        for (const requiredTool of evalTest.expectedToolCalls.required) {
          const wasExecuted = executedTools.some(
            (call) => call.name === requiredTool,
          );
          if (!wasExecuted) {
            validationErrors.push(
              `Required tool '${requiredTool}' was not called`,
            );
          }
        }
      }

      // Check prohibited tools
      if (evalTest.expectedToolCalls.prohibited) {
        for (const prohibitedTool of evalTest.expectedToolCalls.prohibited) {
          const wasExecuted = executedTools.some(
            (call) => call.name === prohibitedTool,
          );
          if (wasExecuted) {
            validationErrors.push(
              `Prohibited tool '${prohibitedTool}' was called`,
            );
          }
        }
      }

      // Check that all executed tools are either required or allowed
      const allowedTools = new Set([
        ...(evalTest.expectedToolCalls.required || []),
        ...(evalTest.expectedToolCalls.allowed || []),
      ]);

      if (allowedTools.size > 0) {
        for (const executedTool of executedTools) {
          if (!allowedTools.has(executedTool.name)) {
            validationErrors.push(
              `Unexpected tool '${executedTool.name}' was called (not in required or allowed list)`,
            );
          }
        }
      }
    }

    // Validate output with scorers
    for (const [index, scorer] of evalTest.responseScorers.entries()) {
      try {
        const scorerResult = await this.runScorer(scorer, output);
        if (!scorerResult.passed) {
          validationErrors.push(
            `Output scorer ${index + 1} (${scorer.type}) failed: ${scorerResult.error}`,
          );
        }
      } catch (error) {
        validationErrors.push(
          `Output scorer ${index + 1} (${scorer.type}) error: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }

    return {
      name: evalTest.name,
      passed: validationErrors.length === 0,
      error:
        validationErrors.length > 0 ? validationErrors.join("; ") : undefined,
      details: {
        toolCallsExecuted: executedTools,
        output,
        conversationSteps,
        validationErrors,
      },
    };
  }

  private async runScorer(
    scorer: EvalConfig["evals"][0]["responseScorers"][0],
    output: string,
  ): Promise<{ passed: boolean; error?: string }> {
    switch (scorer.type) {
      case "json-schema":
        if (!scorer.schema) {
          return {
            passed: false,
            error: "No schema provided for json-schema scorer",
          };
        }
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
        return { passed: false, error: "LLM judge scorer not yet implemented" };

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
}

export async function runEvals(
  client: Client,
  configPath: string,
): Promise<void> {
  const engine = new EvalEngine(client);
  await engine.runEvals(configPath);
}
