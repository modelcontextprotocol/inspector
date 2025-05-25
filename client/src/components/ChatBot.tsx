import React, { useState, useCallback } from "react";
import ChatBotIcon from "./ChatBotIcon";
import ChatBotInterface from "./ChatBotInterface";
import ChatBotSettings from "./ChatBotSettings";
import { useChatBot } from "@/hooks/useChatBot";
import { CHATBOT_CONFIG } from "@/lib/chat/config";
import { Tool } from "@modelcontextprotocol/sdk/types.js";

interface ChatBotProps {
  tools: Tool[];
  isConnected: boolean;
  onExecuteTool: (toolName: string, args: any) => Promise<any>;
}

const ChatBot: React.FC<ChatBotProps> = ({ tools, isConnected, onExecuteTool }) => {
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(CHATBOT_CONFIG.hasApiKey());

  const apiKey = CHATBOT_CONFIG.getOpenAIApiKey();

  const { messages, isLoading, sendMessage } = useChatBot({
    apiKey,
    mcpTools: tools,
    onExecuteTool,
  });

  const handleApiKeyChange = useCallback((newHasKey: boolean) => {
    setHasApiKey(newHasKey);
  }, []);

  const handleSendMessage = useCallback(async (content: string) => {
    if (!hasApiKey) {
      // This shouldn't happen as the UI should prevent it, but just in case
      console.error("No OpenAI API key configured");
      return;
    }
    await sendMessage(content);
  }, [hasApiKey, sendMessage]);

  // Don't render anything if not connected to an MCP server
  if (!isConnected) {
    return null;
  }

  return (
    <>
      {/* Settings button - always visible when connected */}
      <ChatBotSettings onApiKeyChange={handleApiKeyChange} />
      
      {/* Chat components - only visible if API key is configured */}
      {hasApiKey && (
        <>
          <ChatBotIcon
            onClick={() => setIsChatOpen(!isChatOpen)}
            isOpen={isChatOpen}
          />
          <ChatBotInterface
            isOpen={isChatOpen}
            onClose={() => setIsChatOpen(false)}
            messages={messages}
            onSendMessage={handleSendMessage}
            isLoading={isLoading}
          />
        </>
      )}
    </>
  );
};

export default ChatBot;
