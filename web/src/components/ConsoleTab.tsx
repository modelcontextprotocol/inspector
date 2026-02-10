import { TabsContent } from "@/components/ui/tabs";
import type { StderrLogEntry } from "@modelcontextprotocol/inspector-shared/mcp/index.js";

interface ConsoleTabProps {
  stderrLogs: StderrLogEntry[];
}

const ConsoleTab = ({ stderrLogs }: ConsoleTabProps) => {
  const formatTimestamp = (timestamp: Date) => {
    return new Date(timestamp).toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      // @ts-expect-error - fractionalSecondDigits is valid but not in TypeScript types yet
      fractionalSecondDigits: 3,
    });
  };

  return (
    <TabsContent value="console" className="flex-1 flex flex-col min-h-0 mt-0">
      <div className="flex-1 min-h-0 bg-gray-900 text-gray-100 p-4 rounded-lg font-mono text-sm overflow-auto">
        {stderrLogs.length === 0 ? (
          <div className="opacity-50">No stderr output yet</div>
        ) : (
          <div className="space-y-1">
            {stderrLogs.map((log, index) => (
              <div key={index} className="flex gap-2">
                <span className="text-gray-500 flex-shrink-0">
                  {formatTimestamp(log.timestamp)}
                </span>
                <span className="flex-1 whitespace-pre-wrap break-words">
                  {log.message}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </TabsContent>
  );
};

export default ConsoleTab;
