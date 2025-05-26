import React, { useState, useEffect, useRef } from "react";
import { useMcpClient } from "@/context/McpClientContext";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { Anthropic } from "@anthropic-ai/sdk";
import { Send, Bot, User, Loader2, Key } from "lucide-react";
import { cn } from "@/lib/utils";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

const ChatTab: React.FC = () => {
  const mcpClient = useMcpClient();
  const [input, setInput] = useState("");
  const [chat, setChat] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tools, setTools] = useState<Tool[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Get API key from the MCP client
  const claudeApiKey =
    mcpClient && "anthropic" in mcpClient && mcpClient.anthropic
      ? (mcpClient.anthropic as Anthropic).apiKey || ""
      : "";

  // Fetch tools on mount
  useEffect(() => {
    let mounted = true;
    async function fetchTools() {
      if (!mcpClient) return;
      try {
        const response = await mcpClient.listTools();
        if (mounted) setTools(response.tools || []);
      } catch (e: unknown) {
        const errorMessage =
          e instanceof Error ? e.message : "Failed to fetch tools";
        setError(errorMessage);
      }
    }
    fetchTools();
    return () => {
      mounted = false;
    };
  }, [mcpClient]);

  // Scroll to bottom on new message
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat]);

  // Focus input when component mounts
  useEffect(() => {
    if (claudeApiKey && inputRef.current) {
      inputRef.current.focus();
    }
  }, [claudeApiKey]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!input.trim() || !mcpClient || !claudeApiKey) return;

    const userMessage = input.trim();
    const newMessage: Message = {
      role: "user",
      content: userMessage,
      timestamp: new Date(),
    };

    setChat((prev) => [...prev, newMessage]);
    setInput("");
    setLoading(true);

    try {
      // Check if processQuery method exists on the client
      if (
        mcpClient &&
        "processQuery" in mcpClient &&
        typeof mcpClient.processQuery === "function"
      ) {
        const response = await (
          mcpClient as typeof mcpClient & {
            processQuery: (query: string, tools: Tool[]) => Promise<string>;
          }
        ).processQuery(userMessage, tools);
        const assistantMessage: Message = {
          role: "assistant",
          content: response,
          timestamp: new Date(),
        };
        setChat((prev) => [...prev, assistantMessage]);
      } else {
        throw new Error(
          "Chat functionality is not available. Please ensure you have a valid API key and the server is connected.",
        );
      }
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
        const formEvent = new Event("submit", {
          bubbles: true,
          cancelable: true,
        });
        Object.defineProperty(formEvent, "preventDefault", {
          value: () => e.preventDefault(),
          writable: false,
        });
        handleSend(formEvent as unknown as React.FormEvent);
      }
    }
  };

  const isDisabled = loading || !claudeApiKey;
  const isSendDisabled = isDisabled || !input.trim();

  // Loading dots animation component
  const LoadingDots = () => (
    <div className="flex items-center space-x-1 py-3">
      <div className="flex space-x-1">
        <div className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
        <div className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
        <div className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full animate-bounce"></div>
      </div>
    </div>
  );

  // Message component
  const MessageBubble = ({ message }: { message: Message }) => {
    const isUser = message.role === "user";

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
          <p className="text-sm leading-relaxed whitespace-pre-wrap">
            {message.content}
          </p>
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

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-border bg-background">
        <div className="px-4 sm:px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-600 flex items-center justify-center">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-base font-medium text-foreground">Claude</h1>
              <p className="text-xs text-muted-foreground">
                {claudeApiKey ? "Online" : "API key required"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto bg-background">
        {!claudeApiKey ? (
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
        ) : chat.length === 0 ? (
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
                {[
                  "Hello!",
                  "Help me code",
                  "Explain something",
                  "Write for me",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => setInput(suggestion)}
                    className="px-3 py-1.5 text-xs bg-muted hover:bg-muted/80 rounded-full transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          </div>
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
                onChange={(e) => setInput(e.target.value)}
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
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = "auto";
                  target.style.height =
                    Math.min(target.scrollHeight, 128) + "px";
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
