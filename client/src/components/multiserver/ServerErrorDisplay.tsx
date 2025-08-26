import { AlertCircle, X } from "lucide-react";
import { StdErrNotification } from "../../lib/notificationTypes.js";
import { Button } from "../ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import { Badge } from "../ui/badge.js";

interface ServerErrorDisplayProps {
  serverId: string;
  serverName: string;
  errors: StdErrNotification[];
  onClearErrors?: (serverId: string) => void;
  maxHeight?: string;
  showHeader?: boolean;
  compact?: boolean;
}

/**
 * Reusable component for displaying stderr notifications from MCP servers
 * Supports both compact and detailed views with efficient rendering
 */
export function ServerErrorDisplay({
  serverId,
  serverName,
  errors,
  onClearErrors,
  maxHeight = "300px",
  showHeader = true,
  compact = false,
}: ServerErrorDisplayProps) {
  if (errors.length === 0) {
    return null;
  }

  const truncateContent = (content: string, maxLength: number = 100) => {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + "...";
  };

  if (compact) {
    return (
      <div className="space-y-2">
        {showHeader && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-500" />
              <span className="text-sm font-medium text-red-700">
                {errors.length} error{errors.length !== 1 ? "s" : ""}
              </span>
            </div>
            {onClearErrors && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onClearErrors(serverId)}
                className="h-6 px-2 text-xs"
              >
                Clear
              </Button>
            )}
          </div>
        )}
        <div className="space-y-1 overflow-y-auto" style={{ maxHeight }}>
          {errors.slice(0, 5).map((error, index) => (
            <div
              key={`${serverId}-error-${index}`}
              className="flex items-start gap-2 p-2 bg-red-50 border border-red-200 rounded text-xs"
            >
              <AlertCircle className="h-3 w-3 text-red-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-red-800 break-words">
                  {truncateContent(error.params.content, 80)}
                </p>
              </div>
            </div>
          ))}
          {errors.length > 5 && (
            <div className="text-xs text-gray-500 text-center py-1">
              ... and {errors.length - 5} more error
              {errors.length - 5 !== 1 ? "s" : ""}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <Card className="border-red-200">
      {showHeader && (
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-red-700">
              <AlertCircle className="h-5 w-5" />
              Error output from {serverName}
              <Badge variant="destructive" className="ml-2">
                {errors.length}
              </Badge>
            </CardTitle>
            {onClearErrors && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onClearErrors(serverId)}
                className="flex items-center gap-1"
              >
                <X className="h-4 w-4" />
                Clear
              </Button>
            )}
          </div>
        </CardHeader>
      )}
      <CardContent>
        <div className="space-y-3 overflow-y-auto" style={{ maxHeight }}>
          {errors.map((error, index) => (
            <div
              key={`${serverId}-error-${index}`}
              className="flex flex-col gap-2 p-3 bg-red-50 border border-red-200 rounded-md"
            >
              <div className="text-sm text-red-500 font-mono py-2 border-b border-gray-200 last:border-b-0">
                {error.params.content}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
