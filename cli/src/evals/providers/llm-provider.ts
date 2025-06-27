// LLM provider interface with individual parsing methods
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { SingleEvalConfig, LlmJudgeResult, ToolCallResult } from "../types.js";

export interface LLMProvider<LlmMessage = unknown> {
  // Execute a conversation with tool calling - returns provider-specific format
  executeConversation(
    mcpClient: Client,
    prompt: string,
    config: SingleEvalConfig
  ): Promise<LlmMessage[]>;

  // Individual parsing methods for provider-specific messages
  getAllAssistantText(messages: LlmMessage[]): string;
  getOriginalPrompt(messages: LlmMessage[]): string;
  extractToolCallResults(messages: LlmMessage[]): ToolCallResult[];
  formatMessagesForLLM(messages: LlmMessage[]): string;

  // Run LLM judge eval
  runLLMJudge(
    criteria: string,
    originalPrompt: string,
    conversation: string
  ): Promise<LlmJudgeResult>;
}