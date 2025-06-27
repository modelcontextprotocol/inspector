import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import { validateEvalConfig } from "./schema.js";
import type { EvalConfig, EvalResult, EvalSummary, EvalTest, ConversationConfig } from "./types.js";
import { executeConversation } from "./conversation.js";
import { validateExpectedToolCalls } from "./validation.js";
import { extractToolCallNames } from "./message-parser.js";
import { runResponseScorers } from "./scorers.js";
// TODO: Enhanced display formatting in follow-up PR


export async function runEvals(
  mcpClient: Client,
  configPath: string,
): Promise<EvalSummary> {
  const config = loadConfig(configPath);
  
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY environment variable is required for evaluation mode.\n" +
        "Please set your API key: export ANTHROPIC_API_KEY=your_api_key_here",
    );
  }

  const anthropicClient = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  // Run all evals in parallel
  const results = await Promise.all(
    config.evals.map(evalTest => 
      runSingleEval(mcpClient, anthropicClient, evalTest, config.conversationConfig)
    )
  );

  const summary: EvalSummary = {
    total: results.length,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    results,
  };

  // Simple console output for now
  console.log(`\nRunning ${summary.total} eval tests...\n`);
  
  summary.results.forEach(result => {
    if (result.passed) {
      console.log(`✅ ${result.name}: PASSED`);
    } else {
      console.log(`❌ ${result.name}: FAILED`);
      result.errors.forEach(error => {
        console.log(`   • ${error}`);
      });
    }
  });
  
  console.log(`\nResults: ${summary.passed}/${summary.total} tests passed`);

  return summary;
}

async function runSingleEval(
  mcpClient: Client,
  anthropicClient: Anthropic,
  evalTest: EvalTest,
  config: ConversationConfig,
): Promise<EvalResult> {
  try {

    // Run the conversation
    const messages = await executeConversation(mcpClient, anthropicClient, evalTest.prompt, config);

    // Extract tool call names for validation, then validate expected tool calls
    const toolCallNames = extractToolCallNames(messages);
    const toolValidationErrors = validateExpectedToolCalls(evalTest.expectedToolCalls, toolCallNames);

    // Run response scorers (if any)
    const scorerResults = evalTest.responseScorers 
      ? await runResponseScorers(evalTest.responseScorers, messages, anthropicClient)
      : [];
    const scorerErrors = scorerResults.filter(r => !r.passed).map((r, i) => 
      `Output scorer ${i + 1} (${evalTest.responseScorers?.[i]?.type}) failed: ${r.error || 'Unknown error'}`
    );

    const allErrors = [...toolValidationErrors, ...scorerErrors];
    const passed = allErrors.length === 0;

    return {
      name: evalTest.name,
      passed,
      errors: allErrors,
      scorerResults,
      // Only include messages for failed tests (for detailed display)
      messages: passed ? undefined : messages,
    };
  } catch (error) {
    return {
      name: evalTest.name,
      passed: false,
      errors: [error instanceof Error ? error.message : "Unknown error"],
      scorerResults: [],
    };
  }
}

function loadConfig(configPath: string): EvalConfig & { conversationConfig: ConversationConfig } {
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

  const baseConfig = config as EvalConfig;
  
  // AJV has already applied schema defaults, so we can use them directly
  const conversationConfig: ConversationConfig = {
    model: baseConfig.config.model,
    maxSteps: baseConfig.config.maxSteps,
    timeout: baseConfig.config.timeout,
  };

  return {
    ...baseConfig,
    conversationConfig,
  };
}