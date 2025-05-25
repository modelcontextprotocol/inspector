import { useState, useCallback } from "react";
import { useOpenAI } from "./useOpenAI";
import { ChatMessage, ChatState, ToolCall, ToolResult, OpenAIFunction } from "@/lib/chat-types";
import { convertMCPToolToOpenAIFunction } from "@/lib/chat/tool-converter";
import { generateId } from "@/lib/chat/tool-converter";

// Define the message param type locally
interface ChatCompletionMessageParam {
  role: "user" | "assistant" | "system";
  content: string;
}

interface UseChatBotOptions {
  apiKey: string;
  mcpTools: any[]; // MCP tool schemas
  onExecuteTool: (toolName: string, args: any) => Promise<any>;
}

interface UseChatBotReturn extends ChatState {
  sendMessage: (content: string) => Promise<void>;
  clearMessages: () => void;
}

const WELCOME_MESSAGE: ChatMessage = {
  id: generateId(),
  role: "assistant",
  content: "Hello! I'm your MCP Assistant. I can help you interact with the connected MCP tools and answer questions about your system. What can I help you with today?",
  timestamp: new Date(),
};

export const useChatBot = ({ 
  apiKey, 
  mcpTools, 
  onExecuteTool 
}: UseChatBotOptions): UseChatBotReturn => {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME_MESSAGE]);
  const [isLoading, setIsLoading] = useState(false);

  // Convert MCP tools to OpenAI function format
  const openAIFunctions: OpenAIFunction[] = mcpTools?.map(convertMCPToolToOpenAIFunction) || [];

  const handleToolCall = useCallback(async (toolCall: ToolCall): Promise<ToolResult> => {
    try {
      const args = JSON.parse(toolCall.function.arguments);
      const result = await onExecuteTool(toolCall.function.name, args);
      
      return {
        content: typeof result === "string" ? result : JSON.stringify(result, null, 2),
        isError: false,
      };
    } catch (error) {
      return {
        content: error instanceof Error ? error.message : "Unknown error occurred",
        isError: true,
      };
    }
  }, [onExecuteTool]);

  const { sendMessage: sendToOpenAI, error } = useOpenAI({
    apiKey,
    onToolCall: handleToolCall,
  });

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isLoading || !apiKey) return;

    // Add user message
    const userMessage: ChatMessage = {
      id: generateId(),
      role: "user",
      content,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    try {
      // Prepare messages for OpenAI
      const openAIMessages: ChatCompletionMessageParam[] = messages
        .concat(userMessage)
        .map(msg => ({
          role: msg.role,
          content: msg.content || "",
        }));

      // Send to OpenAI
      const response = await sendToOpenAI(openAIMessages, openAIFunctions);

      // Create assistant message
      const assistantMessage: ChatMessage = {
        id: generateId(),
        role: "assistant",
        content: response.content || "",
        toolCalls: response.toolCalls.length > 0 ? response.toolCalls : undefined,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, assistantMessage]);

      // If there were tool calls, add their results as system messages
      if (response.toolCalls.length > 0) {
        const toolResultMessages: ChatMessage[] = response.toolCalls.map(toolCall => ({
          id: generateId(),
          role: "system" as const,
          content: `Tool ${toolCall.function.name} ${toolCall.status === "success" ? "completed" : "failed"}: ${toolCall.result}`,
          timestamp: new Date(),
        }));

        setMessages(prev => [...prev, ...toolResultMessages]);
      }
    } catch (err) {
      // Add error message
      const errorMessage: ChatMessage = {
        id: generateId(),
        role: "assistant",
        content: `Sorry, I encountered an error: ${err instanceof Error ? err.message : "Unknown error"}`,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }, [messages, isLoading, sendToOpenAI, openAIFunctions]);

  const clearMessages = useCallback(() => {
    setMessages([WELCOME_MESSAGE]);
  }, []);

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    clearMessages,
  };
};
