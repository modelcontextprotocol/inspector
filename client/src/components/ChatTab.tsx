import React, { useState, useEffect, useRef } from "react";
import { useMcpClient } from "@/context/McpClientContext";
import { Tool } from "@modelcontextprotocol/sdk/types.js";
import { Anthropic } from "@anthropic-ai/sdk";

const ChatTab: React.FC = () => {
  const mcpClient = useMcpClient();
  const [input, setInput] = useState("");
  const [chat, setChat] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tools, setTools] = useState<Tool[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Get API key from the MCP client
  const claudeApiKey = (mcpClient && 'anthropic' in mcpClient && mcpClient.anthropic) 
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
        const errorMessage = e instanceof Error ? e.message : "Failed to fetch tools";
        setError(errorMessage);
      }
    }
    fetchTools();
    return () => { mounted = false; };
  }, [mcpClient]);

  // Scroll to bottom on new message
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!input.trim() || !mcpClient || !claudeApiKey) return;
    const userMessage = input.trim();
    setChat((prev) => [...prev, { role: "user", content: userMessage }]);
    setInput("");
    setLoading(true);
    try {
      // Check if processQuery method exists on the client
      if (mcpClient && 'processQuery' in mcpClient && typeof mcpClient.processQuery === 'function') {
        const response = await (mcpClient as typeof mcpClient & { processQuery: (query: string, tools: Tool[]) => Promise<string> }).processQuery(userMessage, tools);
        setChat((prev) => [...prev, { role: "assistant", content: response }]);
      } else {
        throw new Error("Chat functionality is not available. Please ensure you have a valid API key and the server is connected.");
      }
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : "Error sending message";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const isDisabled = loading || !claudeApiKey;
  const isSendDisabled = isDisabled || !input.trim();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Chat Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: 16, background: "#fafbfc" }}>
        {!claudeApiKey && (
          <div style={{ 
            textAlign: "center", 
            padding: "40px 20px", 
            color: "#666",
            background: "#f8f9fa",
            borderRadius: 8,
            margin: "20px 0"
          }}>
            <p style={{ fontSize: 16, marginBottom: 8 }}>
              🔑 Claude API Key Required
            </p>
            <p style={{ fontSize: 14 }}>
              Please configure your Claude API key in the header section above to start chatting.
            </p>
          </div>
        )}
        
        {chat.map((msg, idx) => (
          <div key={idx} style={{ marginBottom: 12, textAlign: msg.role === "user" ? "right" : "left" }}>
            <div
              style={{
                display: "inline-block",
                background: msg.role === "user" ? "#e6f7ff" : "#f5f5f5",
                color: "#222",
                borderRadius: 8,
                padding: "8px 12px",
                maxWidth: "70%",
                wordBreak: "break-word",
              }}
            >
              {msg.content}
            </div>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* Error Display */}
      {error && (
        <div style={{ color: "#d32f2f", padding: 8, background: "#fff0f0" }}>{error}</div>
      )}

      {/* Input Form */}
      <form onSubmit={handleSend} style={{ display: "flex", padding: 16, background: "#fff", borderTop: "1px solid #eee" }}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            !claudeApiKey 
              ? "Please configure your Claude API key in the header section above..." 
              : loading 
                ? "Waiting for response..." 
                : "Type your message..."
          }
          disabled={isDisabled}
          style={{ 
            flex: 1, 
            padding: 10, 
            borderRadius: 6, 
            border: "1px solid #ccc", 
            fontSize: 16,
            opacity: !claudeApiKey ? 0.6 : 1
          }}
        />
        <button
          type="submit"
          disabled={isSendDisabled}
          style={{ 
            marginLeft: 8, 
            padding: "0 20px", 
            borderRadius: 6, 
            border: "none", 
            background: isSendDisabled ? "#ccc" : "#1677ff", 
            color: "#fff", 
            fontWeight: 600, 
            fontSize: 16, 
            cursor: isSendDisabled ? "not-allowed" : "pointer" 
          }}
        >
          Send
        </button>
      </form>
    </div>
  );
};

export default ChatTab;
