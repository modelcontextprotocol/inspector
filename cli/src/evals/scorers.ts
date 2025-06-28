import AjvLib from "ajv";
const Ajv = AjvLib.default || AjvLib;
import type {
  ResponseScorer,
  ScorerResult,
  JsonSchemaScorer,
  RegexScorer,
  LlmJudgeScorer,
} from "./types.js";
import type { LLMProvider } from "./providers/llm-provider.js";

export async function runResponseScorers<LlmMessage>(
  scorers: ResponseScorer[],
  messages: LlmMessage[],
  llmProvider: LLMProvider<LlmMessage>,
): Promise<ScorerResult[]> {
  const results: ScorerResult[] = [];

  for (const scorer of scorers) {
    try {
      const result = await scoreResponse(scorer, messages, llmProvider);
      results.push(result);
    } catch (error) {
      results.push({
        passed: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return results;
}

async function scoreResponse<LlmMessage>(
  scorer: ResponseScorer,
  messages: LlmMessage[],
  llmProvider: LLMProvider<LlmMessage>,
): Promise<ScorerResult> {
  switch (scorer.type) {
    case "json-schema":
      return scoreJsonSchema(scorer, messages, llmProvider);
    case "regex":
      return scoreRegex(scorer, messages, llmProvider);
    case "llm-judge":
      return scoreLlmJudge(scorer, messages, llmProvider);
    default:
      return {
        passed: false,
        error: `Unknown scorer type: ${(scorer as any).type}`,
      };
  }
}

function scoreJsonSchema<LlmMessage>(
  scorer: JsonSchemaScorer,
  messages: LlmMessage[],
  llmProvider: LLMProvider<LlmMessage>,
): ScorerResult {
  if (!scorer.schema) {
    return {
      passed: false,
      error: "No schema provided for json-schema scorer",
    };
  }

  const output = llmProvider.getAllAssistantText(messages);
  const ajv = new Ajv();
  const isValid = ajv.validate(scorer.schema, output);

  if (!isValid) {
    return {
      passed: false,
      error: ajv.errorsText() || "Schema validation failed",
    };
  }

  return { passed: true };
}

function scoreRegex<LlmMessage>(
  scorer: RegexScorer,
  messages: LlmMessage[],
  llmProvider: LLMProvider<LlmMessage>,
): ScorerResult {
  try {
    const output = llmProvider.getAllAssistantText(messages);
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
}

async function scoreLlmJudge<LlmMessage>(
  scorer: LlmJudgeScorer,
  messages: LlmMessage[],
  llmProvider: LLMProvider<LlmMessage>,
): Promise<ScorerResult> {
  if (!scorer.criteria) {
    return {
      passed: false,
      error: "No criteria provided for llm-judge scorer",
    };
  }

  try {
    const conversation = llmProvider.formatMessagesForLLM(messages);
    const originalPrompt = llmProvider.getOriginalPrompt(messages);
    const judgeResult = await llmProvider.runLLMJudge(
      scorer.criteria,
      originalPrompt,
      conversation,
    );
    const threshold = scorer.threshold || 1.0;

    if (judgeResult.score < threshold) {
      return {
        passed: false,
        error: `LLM judge score ${judgeResult.score.toFixed(2)} below threshold ${threshold}. Rationale: ${judgeResult.rationale}`,
      };
    }
    return { passed: true };
  } catch (error) {
    return {
      passed: false,
      error: `LLM judge error: ${error instanceof Error ? error.message : "Unknown error"}`,
    };
  }
}
