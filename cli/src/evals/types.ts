import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";

export interface ScorerResult {
  passed: boolean;
  error?: string;
  judgeRationale?: string;
}

export interface EvalResult {
  name: string;
  passed: boolean;
  errors: string[];
  scorerResults: ScorerResult[];
  // Raw data for detailed display (only when needed)
  messages?: MessageParam[];
}

export interface EvalSummary {
  total: number;
  passed: number;
  failed: number;
  results: EvalResult[];
}

export interface ConversationConfig {
  model: string;
  maxSteps: number;
  timeout: number;
}

export interface ToolCallRules {
  required?: string[];
  prohibited?: string[];
  allowed?: string[];
}

export interface JsonSchemaScorer {
  type: "json-schema";
  schema: any;
}

export interface RegexScorer {
  type: "regex";
  pattern: string;
}

export interface LlmJudgeScorer {
  type: "llm-judge";
  criteria: string;
  threshold?: number;
}

export type ResponseScorer = JsonSchemaScorer | RegexScorer | LlmJudgeScorer;

export interface EvalTest {
  name: string;
  description?: string;
  prompt: string;
  expectedToolCalls?: ToolCallRules;
  responseScorers?: ResponseScorer[];
}

export interface EvalConfig {
  config: {
    model: string;
    maxSteps: number;
    timeout: number;
  };
  evals: EvalTest[];
}

export interface LlmJudgeResult {
  score: number;
  rationale: string;
}