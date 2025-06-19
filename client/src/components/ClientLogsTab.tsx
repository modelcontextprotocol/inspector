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
  const reversedClientLogs = [...clientLogs].reverse();
  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("en-US", {
      hour12: true,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const getLogLevelConfig = (level: ClientLogInfo["level"]) => {
    switch (level) {
      case "error":
        return {
          icon: AlertCircle,
          bgColor: "bg-red-50 dark:bg-red-950/20",
          borderColor: "border-red-200 dark:border-red-800/50",
          textColor: "text-red-800 dark:text-red-300",
          iconColor: "text-red-500",
          label: "ERROR",
        };
      case "warn":
        return {
          icon: AlertTriangle,
          bgColor: "bg-yellow-50 dark:bg-yellow-950/20",
          borderColor: "border-yellow-200 dark:border-yellow-800/50",
          textColor: "text-yellow-800 dark:text-yellow-300",
          iconColor: "text-yellow-500",
          label: "WARN",
        };
      case "debug":
        return {
          icon: Bug,
          bgColor: "bg-gray-50 dark:bg-gray-950/20",
          borderColor: "border-gray-200 dark:border-gray-800/50",
          textColor: "text-gray-800 dark:text-gray-300",
          iconColor: "text-gray-500",
          label: "DEBUG",
        };
      case "info":
      default:
        return {
          icon: Info,
          bgColor: "bg-blue-50 dark:bg-blue-950/20",
          borderColor: "border-blue-200 dark:border-blue-800/50",
          textColor: "text-blue-800 dark:text-blue-300",
          iconColor: "text-blue-500",
          label: "INFO",
        };
    }
  };

  const LogEntry = ({ log }: { log: ClientLogInfo }) => {
    const config = getLogLevelConfig(log.level);
    const IconComponent = config.icon;

    return (
      <div
        className={`flex items-start space-x-3 p-3 rounded-lg border ${config.bgColor} ${config.borderColor} hover:shadow-sm transition-all duration-200`}
      >
        <div className={`flex-shrink-0 mt-0.5 ${config.iconColor}`}>
          <IconComponent className="w-4 h-4" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2 mb-1">
            <span
              className={`text-xs font-mono font-semibold px-2 py-0.5 rounded ${config.textColor} ${config.bgColor}`}
            >
              {config.label}
            </span>
            <span className="text-xs text-muted-foreground font-mono">
              {formatTimestamp(log.timestamp)}
            </span>
          </div>

          <div className={`text-sm ${config.textColor} font-mono break-words`}>
            {log.message}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col">
      {showHeader && (
        <div className="flex items-center justify-between p-4 border-b border-border/50">
          <div className="flex items-center space-x-2">
            <Bug className="w-5 h-5 text-muted-foreground" />
            <h3 className="text-lg font-semibold">Client Logs</h3>
            {clientLogs.length > 0 && (
              <span className="px-2 py-1 text-xs bg-primary/10 text-primary rounded-full font-medium">
                {clientLogs.length}
              </span>
            )}
          </div>

          {clientLogs.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={onClearLogs}
              className="flex items-center space-x-2"
            >
              <Trash2 className="w-4 h-4" />
              <span>Clear Logs</span>
            </Button>
          )}
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        {clientLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <Bug className="w-12 h-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium text-muted-foreground mb-2">
              No logs yet
            </h3>
            <p className="text-sm text-muted-foreground/70 max-w-sm">
              Client logs will appear here when you perform operations. Logs
              include info, warnings, errors, and debug messages.
            </p>
          </div>
        ) : (
          <div className="h-full overflow-y-auto p-4 space-y-2">
            {reversedClientLogs.map((log, index) => (
              <LogEntry key={`${log.timestamp}-${index}`} log={log} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ClientLogsTab;
