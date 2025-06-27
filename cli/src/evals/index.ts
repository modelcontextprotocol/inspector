import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import fs from "node:fs";
import path from "node:path";
import { validateEvalConfig } from "./schema.js";
import type { EvalConfig, EvalResult, EvalSummary, EvalTest, ConversationConfig } from "./types.js";
import { validateToolCalls } from "./validate-tools.js";
import { runResponseScorers } from "./scorers.js";
import { AnthropicProvider } from "./providers/anthropic-provider.js";

/**
 * Main entry point for running eval tests against an MCP server
 * Executes tests in parallel and displays results as they complete
 */
export async function runEvals(
  mcpClient: Client,
  configPath: string,
): Promise<EvalSummary> {
  const config = loadConfig(configPath);
  
  // Create LLM provider (currently only Anthropic)
  const llmProvider = new AnthropicProvider();

  console.log(`\nRunning ${config.evals.length} eval tests...\n`);

  // Execute tests in parallel for speed, display results as each completes
  const results: EvalResult[] = [];
  const evalPromises = config.evals.map(async (evalTest) => {
    const result = await runSingleEval(mcpClient, llmProvider, evalTest, config.conversationConfig);
    
    // Show immediate feedback for better UX
    if (result.passed) {
      console.log(`✅ ${result.name}: PASSED`);
    } else {
      console.log(`❌ ${result.name}: FAILED`);
      console.log(`   Prompt: "${evalTest.prompt}"`);
      result.errors.forEach(error => {
        console.log(`   • ${error}`);
      });
    }
    
    results.push(result);
    return result;
  });

  // Wait for all to complete
  await Promise.all(evalPromises);

  const summary: EvalSummary = {
    total: results.length,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    results,
  };
  
  console.log(`\nResults: ${summary.passed}/${summary.total} tests passed`);

  return summary;
}

/**
 * Execute a single eval test with comprehensive validation
 * Combines tool call validation and response scoring
 */
async function runSingleEval(
  mcpClient: Client,
  llmProvider: AnthropicProvider,
  evalTest: EvalTest,
  config: ConversationConfig,
): Promise<EvalResult> {
  try {

    // Execute LLM conversation with tool calling enabled
    const messages = await llmProvider.executeConversation(mcpClient, evalTest.prompt, config);

    // Validate tool usage against expected behavior
    const toolCallNames = llmProvider.extractToolCallNames(messages);
    const toolValidationErrors = validateToolCalls(evalTest.expectedToolCalls, toolCallNames);

    // Evaluate response quality using configured scorers (regex, schema, LLM judge)
    const scorerResults = evalTest.responseScorers 
      ? await runResponseScorers(evalTest.responseScorers, messages, llmProvider)
      : [];
    const scorerErrors = createScorerErrorMessages(scorerResults, evalTest.responseScorers);

    // Combine all validation errors to determine pass/fail
    const allErrors = [...toolValidationErrors, ...scorerErrors];
    const passed = allErrors.length === 0;

    return {
      name: evalTest.name,
      passed,
      errors: allErrors,
      scorerResults,
      messages: passed ? undefined : messages, // Include conversation only for failures (debugging)
    };
  } catch (error) {
    // Handle unexpected errors (connection issues, provider failures, etc.)
    return {
      name: evalTest.name,
      passed: false,
      errors: [error instanceof Error ? error.message : "Unknown error"],
      scorerResults: [],
    };
  }
}

/**
 * Load and validate evals configuration from JSON file
 * Resolves relative paths and applies schema validation with helpful error messages
 */
function loadConfig(configPath: string): EvalConfig & { conversationConfig: ConversationConfig } {
  // Handle both absolute and relative config file paths
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

  // Validate config structure and provide detailed error feedback
  const validation = validateEvalConfig(config);
  if (!validation.valid) {
    let errorMessage = `Invalid eval configuration format in: ${resolvedPath}\n\n`;

    if (validation.errors && validation.errors.length > 0) {
      errorMessage += "Validation errors:\n";
      validation.errors.forEach((error) => {
        errorMessage += `  • ${error}\n`;
      });
      errorMessage += "\n";
    }

    errorMessage +=
      "For a valid configuration example, see sample-evals.json in the inspector directory.\n";

    throw new Error(errorMessage);
  }

  const baseConfig = config as EvalConfig;
  
  // Extract conversation settings for LLM provider (schema defaults already applied)
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

/**
 * Create error messages for failed scorers, preserving the correct scorer type and index
 */
function createScorerErrorMessages(
  scorerResults: { passed: boolean; error?: string }[],
  scorers?: { type: string }[]
): string[] {
  if (!scorers) return [];
  
  const errors: string[] = [];
  
  scorerResults.forEach((result, index) => {
    if (result && !result.passed) {
      const errorMessage = createScorerErrorMessage(result, scorers[index], index);
      errors.push(errorMessage);
    }
  });
  
  return errors;
}

/**
 * Create error message for a single failed scorer
 */
function createScorerErrorMessage(
  result: { passed: boolean; error?: string },
  scorer: { type: string } | undefined,
  index: number
): string {
  const scorerType = scorer?.type || 'unknown';
  const errorMessage = result.error || 'Unknown error';
  return `Output scorer ${index + 1} (${scorerType}) failed: ${errorMessage}`;
}