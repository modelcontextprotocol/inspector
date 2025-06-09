import React, { useState, useEffect, useRef } from "react";
import { useMcpClient } from "@/context/McpClientContext";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { Anthropic } from "@anthropic-ai/sdk";
import {
  Send,
  Bot,
  User,
  Loader2,
  Key,
  ChevronDown,
  Wrench,
  AlertTriangle,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CLAUDE_MODELS } from "@/lib/constants";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

// Tool call message types
interface ToolCallInfo {
  type: "tool_call" | "tool_error" | "tool_warning";
  toolName: string;
  args?: string | Record<string, unknown>;
  error?: string;
  message?: string;
}

interface ParsedContent {
  text: string;
  toolCalls: ToolCallInfo[];
}

// Helper functions
const createMessage = (
  role: "user" | "assistant",
  content: string,
): Message => ({
  role,
  content,
  timestamp: new Date(),
});

const getClaudeApiKey = (mcpClient: unknown): string => {
  return mcpClient &&
    typeof mcpClient === "object" &&
    mcpClient !== null &&
    "anthropic" in mcpClient &&
    (mcpClient as { anthropic?: Anthropic }).anthropic
    ? (mcpClient as { anthropic: Anthropic }).anthropic.apiKey || ""
    : "";
};

const validateSendConditions = (
  input: string,
  mcpClient: unknown,
  claudeApiKey: string,
  loading: boolean,
) => {
  return {
    isDisabled: loading || !claudeApiKey,
    isSendDisabled: loading || !claudeApiKey || !input.trim(),
    canSend: input.trim() && mcpClient && claudeApiKey && !loading,
  };
};

const handleTextareaResize = (target: HTMLTextAreaElement) => {
  target.style.height = "auto";
  target.style.height = Math.min(target.scrollHeight, 128) + "px";
};

const createSyntheticFormEvent = (
  preventDefault: () => void,
): React.FormEvent => {
  const formEvent = new Event("submit", {
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(formEvent, "preventDefault", {
    value: preventDefault,
    writable: false,
  });
  return formEvent as unknown as React.FormEvent;
};

// Parse tool call messages from content
const parseToolCallContent = (content: string): ParsedContent => {
  const toolCalls: ToolCallInfo[] = [];
  let cleanText = content;

  // Pattern for tool calls: [Calling tool TOOL_NAME with args ARGS]
  const toolCallPattern = /\[Calling tool (\w+) with args (.*?)\]/g;
  let match;
  while ((match = toolCallPattern.exec(content)) !== null) {
    const [fullMatch, toolName, argsStr] = match;
    try {
      const args = JSON.parse(argsStr);
      toolCalls.push({
        type: "tool_call",
        toolName,
        args,
      });
    } catch {
      toolCalls.push({
        type: "tool_call",
        toolName,
        args: argsStr,
      });
    }
    cleanText = cleanText.replace(fullMatch, "").trim();
  }

  // Pattern for tool errors: [Tool TOOL_NAME failed: ERROR]
  // Handle complex multi-line errors with nested structures
  const toolErrorPattern =
    /\[Tool (\w+) failed: ([\s\S]*?)\](?=\s*(?:\n|$|\[(?:Tool|Warning|Calling)))/g;
  while ((match = toolErrorPattern.exec(content)) !== null) {
    const [fullMatch, toolName, error] = match;
    toolCalls.push({
      type: "tool_error",
      toolName,
      error: error.trim(),
    });
    cleanText = cleanText.replace(fullMatch, "").trim();
  }

  // Pattern for warnings: [Warning: MESSAGE]
  const warningPattern = /\[Warning: (.*?)\]/g;
  while ((match = warningPattern.exec(content)) !== null) {
    const [fullMatch, message] = match;
    toolCalls.push({
      type: "tool_warning",
      toolName: "system",
      message,
    });
    cleanText = cleanText.replace(fullMatch, "").trim();
  }

  return {
    text: cleanText,
    toolCalls,
  };
};

// Tool call message component
const ToolCallMessage: React.FC<{ toolCall: ToolCallInfo }> = ({
  toolCall,
}) => {
  const { type, toolName, args, error, message } = toolCall;

  const getIcon = () => {
    switch (type) {
      case "tool_call":
        return <Wrench className="w-3 h-3" />;
      case "tool_error":
        return <AlertTriangle className="w-3 h-3" />;
      case "tool_warning":
        return <Clock className="w-3 h-3" />;
      default:
        return <Wrench className="w-3 h-3" />;
    }
  };

  const getColors = () => {
    switch (type) {
      case "tool_call":
        return "bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300";
      case "tool_error":
        return "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300";
      case "tool_warning":
        return "bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-300";
      default:
        return "bg-gray-50 dark:bg-gray-950/30 border-gray-200 dark:border-gray-800 text-gray-800 dark:text-gray-300";
    }
  };

  const formatArgs = (args: unknown): string => {
    if (typeof args === "string") return args;
    if (args === null || args === undefined) return String(args);
    try {
      return JSON.stringify(args, null, 2);
    } catch {
      return String(args);
    }
  };

  return (
    <div
      className={cn(
        "rounded-lg border p-3 mb-2 text-xs font-mono",
        getColors(),
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        {getIcon()}
        <span className="font-semibold">
          {type === "tool_call" && `Calling ${toolName}`}
          {type === "tool_error" && `${toolName} failed`}
          {type === "tool_warning" && "Warning"}
        </span>
      </div>

      {type === "tool_call" && args && (
        <div className="mt-2">
          <div className="text-xs opacity-75 mb-1">Arguments:</div>
          <pre className="text-xs bg-black/10 dark:bg-white/10 rounded p-2 overflow-x-auto whitespace-pre-wrap">
            {formatArgs(args) as string}
          </pre>
        </div>
      )}

      {type === "tool_error" && error && (
        <div className="mt-2">
          <div className="text-xs opacity-75 mb-1">Error:</div>
          <pre className="text-xs bg-black/10 dark:bg-white/10 rounded p-2 overflow-x-auto whitespace-pre-wrap">
            {error}
          </pre>
        </div>
      )}

      {type === "tool_warning" && message && (
        <div className="mt-2">
          <div className="text-xs bg-black/10 dark:bg-white/10 rounded p-2">
            {message}
          </div>
        </div>
      )}
    </div>
  );
};

// Loading dots animation component
const LoadingDots: React.FC = () => (
  <div className="flex items-center space-x-1 py-3">
    <div className="flex space-x-1">
      <div className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
      <div className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
      <div className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-bounce"></div>
    </div>
  </div>
);

// Message bubble component
const MessageBubble: React.FC<{ message: Message }> = ({ message }) => {
  const isUser = message.role === "user";
  const parsedContent = parseToolCallContent(message.content);

  return (
    <div
      className={cn(
        "flex gap-3 px-4 py-3",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      {!isUser && (
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center">
          <Bot className="w-4 h-4 text-white" />
        </div>
      )}

      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-4 py-2.5 break-words",
          isUser
            ? "bg-primary text-primary-foreground ml-auto"
            : "bg-muted text-foreground",
        )}
      >
        {/* Regular text content */}
        {parsedContent.text && (
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {parsedContent.text}
          </p>
        )}

        {/* Tool calls */}
        {parsedContent.toolCalls.length > 0 && (
          <div className="mt-3">
            {parsedContent.toolCalls.map((toolCall, index) => (
              <ToolCallMessage key={index} toolCall={toolCall} />
            ))}
          </div>
        )}

        <div
          className={cn(
            "text-xs mt-1 opacity-70",
            isUser ? "text-primary-foreground/70" : "text-muted-foreground",
          )}
        >
          {message.timestamp.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>

      {isUser && (
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary flex items-center justify-center">
          <User className="w-4 h-4 text-primary-foreground" />
        </div>
      )}
    </div>
  );
};

// Model selector component
const ModelSelector: React.FC<{
  selectedModel: string;
  showModelSelector: boolean;
  loading: boolean;
  onToggle: () => void;
  onModelSelect: (modelId: string) => void;
  modelSelectorRef: React.RefObject<HTMLDivElement>;
}> = ({
  selectedModel,
  showModelSelector,
  loading,
  onToggle,
  onModelSelect,
  modelSelectorRef,
}) => (
  <div className="relative" ref={modelSelectorRef}>
    <button
      onClick={onToggle}
      className="flex items-center gap-2 px-3 py-2 text-sm bg-muted hover:bg-muted/80 rounded-md transition-colors"
      disabled={loading}
    >
      <span className="text-foreground">
        {CLAUDE_MODELS.find((m) => m.id === selectedModel)?.name ||
          selectedModel}
      </span>
      <ChevronDown className="w-4 h-4 text-muted-foreground" />
    </button>

    {showModelSelector && (
      <div className="absolute right-0 top-full mt-1 w-64 bg-background border border-border rounded-md shadow-lg z-50">
        <div className="py-1">
          {CLAUDE_MODELS.map((model) => (
            <button
              key={model.id}
              onClick={() => onModelSelect(model.id)}
              className={cn(
                "w-full px-3 py-2 text-left hover:bg-muted transition-colors",
                selectedModel === model.id && "bg-muted",
              )}
            >
              <div className="text-sm font-medium text-foreground">
                {model.name}
              </div>
              <div className="text-xs text-muted-foreground">
                {model.description}
              </div>
            </button>
          ))}
        </div>
      </div>
    )}
  </div>
);

// Empty state components
const ApiKeyRequiredState: React.FC = () => (
  <div className="flex items-center justify-center h-full p-8">
    <div className="text-center max-w-sm space-y-3">
      <div className="w-12 h-12 mx-auto rounded-full bg-muted/50 flex items-center justify-center">
        <Key className="w-6 h-6 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <h3 className="text-base font-medium text-foreground">
          API Key Required
        </h3>
        <p className="text-sm text-muted-foreground">
          Configure your Claude API key to start chatting
        </p>
      </div>
    </div>
  </div>
);

const EmptyChatsState: React.FC<{
  onSuggestionClick: (suggestion: string) => void;
}> = ({ onSuggestionClick }) => {
  const suggestions = [
    "Hello!",
    "Help me code",
    "Explain something",
    "Write for me",
  ];

  return (
    <div className="flex items-center justify-center h-full p-8">
      <div className="text-center max-w-sm space-y-4">
        <div className="w-12 h-12 mx-auto rounded-full bg-gradient-to-br from-purple-500/20 to-blue-600/20 flex items-center justify-center">
          <Bot className="w-6 h-6 text-purple-600 dark:text-purple-400" />
        </div>
        <div className="space-y-2">
          <h3 className="text-base font-medium text-foreground">
            Start chatting with Claude
          </h3>
          <p className="text-sm text-muted-foreground">
            Ask me anything - I'm here to help!
          </p>
        </div>
        <div className="flex flex-wrap gap-2 justify-center pt-2">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              onClick={() => onSuggestionClick(suggestion)}
              className="px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 rounded-full transition-colors"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

const ChatTab: React.FC = () => {
  const mcpClient = useMcpClient();
  const [input, setInput] = useState("");
  const [chat, setChat] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tools, setTools] = useState<Tool[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>(
    "claude-3-5-sonnet-latest",
  );
  const [showModelSelector, setShowModelSelector] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const modelSelectorRef = useRef<HTMLDivElement>(null);

  const claudeApiKey = getClaudeApiKey(mcpClient);
  const { isDisabled, isSendDisabled, canSend } = validateSendConditions(
    input,
    mcpClient,
    claudeApiKey,
    loading,
  );

  // Helper functions for component logic
  const fetchTools = async () => {
    if (!mcpClient) return;
    try {
      const response = await mcpClient.listTools();
      setTools(response.tools || []);
    } catch (e: unknown) {
      const errorMessage =
        e instanceof Error ? e.message : "Failed to fetch tools";
      setError(errorMessage);
    }
  };

  const addMessageToChat = (message: Message) => {
    setChat((prev) => [...prev, message]);
  };

  const processUserQuery = async (userMessage: string) => {
    if (
      !mcpClient ||
      !("processQuery" in mcpClient) ||
      typeof mcpClient.processQuery !== "function"
    ) {
      throw new Error(
        "Chat functionality is not available. Please ensure you have a valid API key and the server is connected.",
      );
    }

    await (
      mcpClient as typeof mcpClient & {
        processQuery: (
          query: string,
          tools: Tool[],
          onUpdate?: (content: string) => void,
          model?: string,
        ) => Promise<string>;
      }
    ).processQuery(
      userMessage,
      tools,
      (content: string) => {
        const assistantMessage = createMessage("assistant", content);
        addMessageToChat(assistantMessage);
      },
      selectedModel,
    );
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!canSend) return;

    const userMessage = input.trim();
    const newMessage = createMessage("user", userMessage);

    addMessageToChat(newMessage);
    setInput("");
    setLoading(true);

    try {
      await processUserQuery(userMessage);
    } catch (e: unknown) {
      const errorMessage =
        e instanceof Error ? e.message : "Error sending message";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isSendDisabled) {
        const formEvent = createSyntheticFormEvent(() => e.preventDefault());
        handleSend(formEvent);
      }
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    handleTextareaResize(e.target);
  };

  const handleModelSelect = (modelId: string) => {
    setSelectedModel(modelId);
    setShowModelSelector(false);
  };

  const toggleModelSelector = () => {
    setShowModelSelector(!showModelSelector);
  };

  // Effects
  useEffect(() => {
    let mounted = true;
    const initializeTools = async () => {
      if (mounted) {
        await fetchTools();
      }
    };
    initializeTools();
    return () => {
      mounted = false;
    };
  }, [mcpClient]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat]);

  useEffect(() => {
    if (claudeApiKey && inputRef.current) {
      inputRef.current.focus();
    }
  }, [claudeApiKey]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        modelSelectorRef.current &&
        !modelSelectorRef.current.contains(event.target as Node)
      ) {
        setShowModelSelector(false);
      }
    };

    if (showModelSelector) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showModelSelector]);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-border bg-background">
        <div className="px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center">
                <Bot className="w-4 h-4 text-white" />
              </div>
              <div>
                <h1 className="text-base font-medium text-foreground">
                  Claude
                </h1>
                <p className="text-xs text-muted-foreground">
                  {claudeApiKey ? "Online" : "API key required"}
                </p>
              </div>
            </div>

            {claudeApiKey && (
              <ModelSelector
                selectedModel={selectedModel}
                showModelSelector={showModelSelector}
                loading={loading}
                onToggle={toggleModelSelector}
                onModelSelect={handleModelSelect}
                modelSelectorRef={modelSelectorRef}
              />
            )}
          </div>
        </div>
      </div>

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto bg-background">
        {!claudeApiKey ? (
          <ApiKeyRequiredState />
        ) : chat.length === 0 ? (
          <EmptyChatsState onSuggestionClick={setInput} />
        ) : (
          <div className="py-2">
            {chat.map((message, idx) => (
              <MessageBubble key={idx} message={message} />
            ))}
            {loading && (
              <div className="flex gap-3 px-4 py-3">
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center">
                  <Bot className="w-4 h-4 text-white" />
                </div>
                <div className="bg-muted rounded-2xl px-4 py-2.5">
                  <LoadingDots />
                </div>
              </div>
            )}
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Error Display */}
      {error && (
        <div className="flex-shrink-0 px-4 py-2 bg-destructive/10 border-t border-destructive/20">
          <div className="flex items-center gap-2 text-destructive text-sm">
            <span className="text-xs">⚠️</span>
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Input Form */}
      <div className="flex-shrink-0 border-t border-border bg-background">
        <div className="p-4">
          <form onSubmit={handleSend} className="relative">
            <div className="relative flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={
                  !claudeApiKey
                    ? "API key required..."
                    : loading
                      ? "Claude is typing..."
                      : "Message Claude..."
                }
                disabled={isDisabled}
                rows={1}
                className={cn(
                  "flex-1 px-4 py-2.5 rounded-2xl border border-border bg-background resize-none",
                  "focus:outline-none focus:ring-1 focus:ring-ring focus:border-transparent",
                  "placeholder:text-muted-foreground text-sm",
                  "min-h-[40px] max-h-32 overflow-y-auto",
                  !claudeApiKey && "opacity-60 cursor-not-allowed",
                )}
                style={{
                  height: "auto",
                  minHeight: "40px",
                  maxHeight: "128px",
                }}
              />
              <button
                type="submit"
                disabled={isSendDisabled}
                className={cn(
                  "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors",
                  isSendDisabled
                    ? "bg-muted text-muted-foreground cursor-not-allowed"
                    : "bg-primary text-primary-foreground hover:bg-primary/90",
                )}
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </div>

            {/* Tips */}
            {claudeApiKey && !loading && (
              <div className="text-xs text-muted-foreground mt-2 px-1">
                <span className="hidden sm:inline">
                  Press Enter to send • Shift+Enter for new line
                </span>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
};

export default ChatTab;
