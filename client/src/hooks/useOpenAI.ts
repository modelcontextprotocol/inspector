import { useState, useCallback, useRef } from "react";
import { OpenAIClient } from "@/lib/chat/openai-client";
import { OpenAIFunction, ToolCall, ToolResult } from "@/lib/chat-types";

// Define the message param type locally
interface ChatCompletionMessageParam {
  role: "user" | "assistant" | "system";
  content: string;
}

interface UseOpenAIOptions {
  apiKey: string;
  onToolCall?: (toolCall: ToolCall) => Promise<ToolResult>;
}

interface UseOpenAIReturn {
  isLoading: boolean;
  error: string | null;
  sendMessage: (
    messages: ChatCompletionMessageParam[],
    tools?: OpenAIFunction[]
  ) => Promise<{
    content: string | null;
    toolCalls: ToolCall[];
  }>;
}

export const useOpenAI = ({ apiKey, onToolCall }: UseOpenAIOptions): UseOpenAIReturn => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<OpenAIClient | null>(null);

  // Initialize client lazily
  const getClient = useCallback(() => {
    if (!clientRef.current && apiKey) {
      clientRef.current = new OpenAIClient(apiKey);
    }
    return clientRef.current;
  }, [apiKey]);

  const sendMessage = useCallback(async (
    messages: ChatCompletionMessageParam[],
    tools?: OpenAIFunction[]
  ) => {
    const client = getClient();
    if (!client) {
      throw new Error("OpenAI client not initialized");
    }

    setIsLoading(true);
    setError(null);

    try {
      const completion = await client.createChatCompletion(messages, tools);
      const message = completion.choices[0]?.message;

      if (!message) {
        throw new Error("No response from OpenAI");
      }

      let content = message.content;
      const toolCalls: ToolCall[] = [];

      // Handle tool calls if present
      if (message.tool_calls && onToolCall) {
        for (const toolCall of message.tool_calls) {
          const mcpToolCall: ToolCall = {
            id: toolCall.id,
            function: {
              name: toolCall.function.name,
              arguments: toolCall.function.arguments,
            },
            status: "pending",
          };

          toolCalls.push(mcpToolCall);

          try {
            // Execute the tool call
            const result = await onToolCall(mcpToolCall);
            mcpToolCall.result = result.content;
            mcpToolCall.status = result.isError ? "error" : "success";
          } catch (err) {
            mcpToolCall.result = err instanceof Error ? err.message : "Unknown error";
            mcpToolCall.status = "error";
          }
        }
      }

      return { content, toolCalls };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error occurred";
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [getClient, onToolCall]);

  return {
    isLoading,
    error,
    sendMessage,
  };
};
