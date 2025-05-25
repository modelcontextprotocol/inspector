import React from "react";
import { User, Bot, Wrench } from "lucide-react";
import { ChatMessage as ChatMessageType } from "@/lib/chat-types";
import ToolCallMessage from "./ToolCallMessage";

interface ChatMessageProps {
  message: ChatMessageType;
}

const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-lg p-3 ${
          isUser
            ? "bg-primary text-primary-foreground"
            : isSystem
            ? "bg-muted text-muted-foreground text-sm italic"
            : "bg-muted"
        }`}
      >
        <div className="flex items-start space-x-2">
          {!isUser && (
            <div className="flex-shrink-0 mt-0.5">
              {isSystem ? (
                <Wrench className="h-4 w-4" />
              ) : (
                <Bot className="h-4 w-4" />
              )}
            </div>
          )}
          <div className="flex-1">
            {message.content && (
              <p className="text-sm whitespace-pre-wrap">{message.content}</p>
            )}
            {message.toolCalls && message.toolCalls.length > 0 && (
              <div className="mt-2 space-y-2">
                {message.toolCalls.map((toolCall, index) => (
                  <ToolCallMessage key={index} toolCall={toolCall} />
                ))}
              </div>
            )}
          </div>
          {isUser && (
            <div className="flex-shrink-0 mt-0.5">
              <User className="h-4 w-4" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatMessage;
