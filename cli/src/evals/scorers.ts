import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import AjvLib from "ajv";
const Ajv = AjvLib.default || AjvLib;
import type { 
  ResponseScorer, 
  ScorerResult, 
  JsonSchemaScorer, 
  RegexScorer, 
  LlmJudgeScorer,
  LlmJudgeResult
} from "./types.js";
import { getAllAssistantText, getOriginalPrompt, formatMessagesForLLM } from "./message-parser.js";

export async function runResponseScorers(
  scorers: ResponseScorer[],
  messages: MessageParam[],
  anthropicClient: Anthropic
): Promise<ScorerResult[]> {
  const results: ScorerResult[] = [];
  
  for (const scorer of scorers) {
    try {
      const result = await scoreResponse(scorer, messages, anthropicClient);
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

async function scoreResponse(
  scorer: ResponseScorer,
  messages: MessageParam[],
  anthropicClient: Anthropic
): Promise<ScorerResult> {
  switch (scorer.type) {
    case "json-schema":
      return scoreJsonSchema(scorer, messages);
    case "regex":
      return scoreRegex(scorer, messages);
    case "llm-judge":
      return scoreLlmJudge(scorer, messages, anthropicClient);
    default:
      return {
        passed: false,
        error: `Unknown scorer type: ${(scorer as any).type}`,
      };
  }
}

function scoreJsonSchema(scorer: JsonSchemaScorer, messages: MessageParam[]): ScorerResult {
  if (!scorer.schema) {
    return {
      passed: false,
      error: "No schema provided for json-schema scorer",
    };
  }

  const output = getAllAssistantText(messages);
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

function scoreRegex(scorer: RegexScorer, messages: MessageParam[]): ScorerResult {
  if (!scorer.pattern) {
    return {
      passed: false,
      error: "No pattern provided for regex scorer",
    };
  }

  try {
    const output = getAllAssistantText(messages);
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

async function scoreLlmJudge(
  scorer: LlmJudgeScorer, 
  messages: MessageParam[],
  anthropicClient: Anthropic
): Promise<ScorerResult> {
  if (!scorer.criteria) {
    return { passed: false, error: "No criteria provided for llm-judge scorer" };
  }
  
  try {
    const conversation = formatMessagesForLLM(messages);
    const originalPrompt = getOriginalPrompt(messages);
    const judgeResult = await runLlmJudge(anthropicClient, scorer.criteria, originalPrompt, conversation);
    const threshold = scorer.threshold || 1.0;
    
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
}

async function runLlmJudge(
  anthropicClient: Anthropic,
  criteria: string, 
  originalPrompt: string, 
  conversation: string
): Promise<LlmJudgeResult> {
  const systemMessage = `You are an expert evaluator of AI assistant conversations. Your task is to assess how well the assistant's response meets the specified evaluation criteria.

Evaluate the response considering:
- Does it directly address what was requested?
- Is the information accurate and helpful? 
- Does it fully satisfy the user's needs?

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

EVALUATION CRITERIA:
${criteria}

Provide your assessment as JSON:
{"score": <number>, "rationale": "<explanation>"}`;

  const response = await anthropicClient.messages.create({
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