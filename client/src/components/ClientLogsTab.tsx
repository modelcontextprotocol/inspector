import { ClientLogInfo } from "@/hooks/helpers/types";
import { Trash2, AlertCircle, Info, AlertTriangle, Bug } from "lucide-react";
import { Button } from "./ui/button";

interface ClientLogsTabProps {
  clientLogs: ClientLogInfo[];
  onClearLogs: () => void;
  showHeader?: boolean;
}

const ClientLogsTab = ({
  clientLogs,
  onClearLogs,
  showHeader = true,
}: ClientLogsTabProps) => {
  const getLogLevelIcon = (level: string) => {
    switch (level) {
      case "error":
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      case "warn":
        return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      case "info":
        return <Info className="w-4 h-4 text-blue-500" />;
      case "debug":
        return <Bug className="w-4 h-4 text-gray-500" />;
      default:
        return <Info className="w-4 h-4 text-gray-500" />;
    }
  };

  const getLogLevelColor = (level: string) => {
    switch (level) {
      case "error":
        return "text-red-600 dark:text-red-400";
      case "warn":
        return "text-yellow-600 dark:text-yellow-400";
      case "info":
        return "text-blue-600 dark:text-blue-400";
      case "debug":
        return "text-gray-600 dark:text-gray-400";
      default:
        return "text-gray-600 dark:text-gray-400";
    }
  };

  const formatTimestamp = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString();
    } catch {
      return timestamp;
    }
  };

  return (
    <div className="h-full flex flex-col">
      {showHeader && (
        <div className="flex items-center justify-between p-4 border-b border-border/50">
          <div className="flex items-center space-x-2">
            <Bug className="w-5 h-5 text-muted-foreground" />
            <h3 className="text-lg font-semibold">Client Logs</h3>
            {clientLogs.length > 0 && (
              <span className="px-2 py-1 text-xs bg-primary/10 text-primary rounded-full">
                {clientLogs.length}
              </span>
            )}
          </div>
          {clientLogs.length > 0 && (
            <Button
              onClick={onClearLogs}
              variant="outline"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Clear Logs
            </Button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {clientLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <Bug className="w-12 h-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium text-muted-foreground mb-2">
              No Client Logs
            </h3>
            <p className="text-sm text-muted-foreground max-w-md">
              Client logs will appear here when you perform operations like
              listing resources, calling tools, or making requests.
            </p>
          </div>
        ) : (
          <div className="space-y-2 p-4">
            {clientLogs.map((log, index) => (
              <div
                key={index}
                className="flex items-start space-x-3 p-3 rounded-lg border border-border/50 bg-card/50 hover:bg-card/80 transition-colors"
              >
                <div className="flex-shrink-0 mt-0.5">
                  {getLogLevelIcon(log.level)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className={`text-sm font-medium uppercase tracking-wide ${getLogLevelColor(
                        log.level,
                      )}`}
                    >
                      {log.level}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatTimestamp(log.timestamp)}
                    </span>
                  </div>
                  <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                    {log.message}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ClientLogsTab;
