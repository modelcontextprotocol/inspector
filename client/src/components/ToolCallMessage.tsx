import React from "react";
import { Wrench, AlertTriangle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

// Tool call message types
export interface ToolCallInfo {
  type: "tool_call" | "tool_error" | "tool_warning";
  toolName: string;
  args?: string | Record<string, unknown>;
  error?: string;
  message?: string;
}

// Tool call message component
export const ToolCallMessage: React.FC<{ toolCall: ToolCallInfo }> = ({
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

export default ToolCallMessage;
