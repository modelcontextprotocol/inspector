import { AlertCircle, AlertTriangle, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card.js";
import { Badge } from "../ui/badge.js";
import { Button } from "../ui/button.js";
import { ServerErrorSummary } from "./types/multiserver.js";

interface ErrorSummaryCardProps {
  errorSummaries: ServerErrorSummary[];
  totalErrorCount: number;
  onViewServerErrors?: (serverId: string) => void;
  onClearAllErrors?: () => void;
}

/**
 * Dashboard card component displaying aggregated error summaries across all servers
 * Follows the single-server error display pattern for consistency
 */
export function ErrorSummaryCard({
  errorSummaries,
  totalErrorCount,
  onViewServerErrors,
  onClearAllErrors,
}: ErrorSummaryCardProps) {
  if (errorSummaries.length === 0) {
    return null;
  }

  const formatTimestamp = (timestamp: Date) => {
    try {
      return timestamp.toLocaleString();
    } catch {
      return "Unknown time";
    }
  };

  const truncateContent = (content: string, maxLength: number = 60) => {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + "...";
  };

  return (
    <Card className="border-red-200">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-red-700">
            <AlertTriangle className="h-5 w-5" />
            Server Errors
            <Badge variant="destructive" className="ml-2">
              {totalErrorCount}
            </Badge>
          </CardTitle>
          {onClearAllErrors && (
            <Button
              variant="outline"
              size="sm"
              onClick={onClearAllErrors}
              className="flex items-center gap-1"
            >
              Clear All
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 max-h-80 overflow-y-auto">
          {errorSummaries.map((summary) => (
            <div
              key={summary.serverId}
              className="flex flex-col gap-2 p-3 bg-red-50 border border-red-200 rounded-md"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-red-500" />
                  <span className="font-medium text-red-700">
                    {summary.serverName}
                  </span>
                  <Badge variant="destructive">{summary.errorCount}</Badge>
                </div>
                {onViewServerErrors && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onViewServerErrors(summary.serverId)}
                    className="h-6 px-2 text-xs"
                  >
                    View
                  </Button>
                )}
              </div>

              {summary.latestError && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-xs text-red-600">
                    <Clock className="h-3 w-3" />
                    <span>Latest error</span>
                    {summary.lastErrorTime && (
                      <span className="text-gray-500">
                        • {formatTimestamp(summary.lastErrorTime)}
                      </span>
                    )}
                  </div>
                  <div className="bg-white p-2 rounded border border-red-100">
                    <pre className="text-xs text-red-800 whitespace-pre-wrap break-words font-mono">
                      {truncateContent(summary.latestError.params.content)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
