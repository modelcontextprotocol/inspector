import React from "react";
import { Wrench, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { ToolCall } from "@/lib/chat-types";

interface ToolCallMessageProps {
  toolCall: ToolCall;
}

const ToolCallMessage: React.FC<ToolCallMessageProps> = ({ toolCall }) => {
  const getStatusIcon = () => {
    switch (toolCall.status) {
      case "pending":
        return <Loader2 className="h-3 w-3 animate-spin" />;
      case "success":
        return <CheckCircle className="h-3 w-3 text-green-500" />;
      case "error":
        return <XCircle className="h-3 w-3 text-red-500" />;
      default:
        return <Wrench className="h-3 w-3" />;
    }
  };

  return (
    <div className="border rounded-md p-2 bg-background/50">
      <div className="flex items-center space-x-2 mb-1">
        <Wrench className="h-3 w-3" />
        <span className="text-xs font-medium">{toolCall.function.name}</span>
        {getStatusIcon()}
      </div>
      
      {toolCall.function.arguments && (
        <div className="text-xs text-muted-foreground mb-2">
          <strong>Arguments:</strong>
          <pre className="mt-1 text-xs bg-muted/50 p-1 rounded overflow-x-auto">
            {JSON.stringify(JSON.parse(toolCall.function.arguments), null, 2)}
          </pre>
        </div>
      )}
      
      {toolCall.result && (
        <div className="text-xs">
          <strong className={toolCall.status === "error" ? "text-red-500" : "text-green-600"}>
            {toolCall.status === "error" ? "Error:" : "Result:"}
          </strong>
          <div className="mt-1 text-xs bg-muted/50 p-1 rounded overflow-x-auto">
            {typeof toolCall.result === "string" 
              ? toolCall.result 
              : JSON.stringify(toolCall.result, null, 2)
            }
          </div>
        </div>
      )}
    </div>
  );
};

export default ToolCallMessage;
