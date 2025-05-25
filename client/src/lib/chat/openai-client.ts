import OpenAI from "openai";
import { OpenAIFunction } from "@/lib/chat-types";

// Define types locally to avoid import issues
interface ChatCompletionMessageParam {
  role: "user" | "assistant" | "system";
  content: string;
}

interface ChatCompletion {
  choices: Array<{
    message: {
      content: string | null;
      tool_calls?: Array<{
        id: string;
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
  }>;
}

export class OpenAIClient {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({
      apiKey,
      dangerouslyAllowBrowser: true, // Note: In production, use a backend proxy
    });
  }

  async createChatCompletion(
    messages: ChatCompletionMessageParam[],
    tools?: OpenAIFunction[],
    temperature: number = 0.7
  ): Promise<ChatCompletion> {
    const requestOptions: any = {
      model: "gpt-3.5-turbo",
      messages,
      temperature,
      max_tokens: 1000,
    };

    if (tools && tools.length > 0) {
      requestOptions.tools = tools.map(tool => ({
        type: "function" as const,
        function: tool,
      }));
      requestOptions.tool_choice = "auto";
    }

    return await this.client.chat.completions.create(requestOptions);
  }

  async createChatCompletionStream(
    messages: ChatCompletionMessageParam[],
    tools?: OpenAIFunction[],
    temperature: number = 0.7
  ) {
    const requestOptions: any = {
      model: "gpt-3.5-turbo",
      messages,
      temperature,
      max_tokens: 1000,
      stream: true,
    };

    if (tools && tools.length > 0) {
      requestOptions.tools = tools.map(tool => ({
        type: "function" as const,
        function: tool,
      }));
      requestOptions.tool_choice = "auto";
    }

    return await this.client.chat.completions.create(requestOptions);
  }
}
