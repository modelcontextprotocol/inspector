import { ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import { useEffect, useRef, useState } from "react";
import { TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";

const LEVEL_COLORS: Record<string, string> = {
  debug: "text-gray-400",
  info: "text-green-400",
  notice: "text-blue-300",
  warning: "text-yellow-400",
  warn: "text-yellow-400",
  error: "text-red-400",
  critical: "text-red-500",
  alert: "text-orange-400",
  emergency: "text-red-600",
};

const ConsoleTab = ({
  serverLogs = [],
}: {
  serverLogs?: ServerNotification[];
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [clearedCount, setClearedCount] = useState(0);

  const allLogEntries = serverLogs.filter(
    (n) => n.method === "notifications/message",
  );
  const logEntries = allLogEntries.slice(clearedCount);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logEntries.length]);

  return (
    <TabsContent value="console" className="h-96">
      <div className="flex flex-col h-full bg-gray-900 rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-700">
          <span className="text-xs text-gray-400 font-mono">
            Server Logs (stderr / MCP logging)
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setClearedCount(allLogEntries.length)}
            disabled={logEntries.length === 0}
            className="text-gray-400 hover:text-gray-200 h-6 text-xs"
          >
            Clear
          </Button>
        </div>
        <div className="flex-1 overflow-auto p-3 font-mono text-sm">
          {logEntries.length === 0 ? (
            <div className="text-gray-500 opacity-50 text-xs">
              No server logs yet. Stderr output and MCP logging notifications
              will appear here.
            </div>
          ) : (
            <div className="space-y-0.5">
              {logEntries.map((notification, index) => {
                const params = notification.params as Record<string, unknown>;
                const level = String(params?.level ?? "info").toLowerCase();
                const logger = String(params?.logger ?? "");
                const data = params?.data;

                let message: string;
                if (typeof data === "string") {
                  message = data;
                } else if (typeof data === "object" && data !== null) {
                  const dataObj = data as Record<string, unknown>;
                  message =
                    typeof dataObj.message === "string"
                      ? dataObj.message
                      : JSON.stringify(data, null, 2);
                } else {
                  message = String(data ?? "");
                }

                const colorClass = LEVEL_COLORS[level] ?? "text-gray-100";

                return (
                  <div key={index} className="flex gap-2 leading-5">
                    <span className="text-gray-500 select-none shrink-0 text-xs">
                      [{level.toUpperCase().slice(0, 7).padEnd(7)}]
                    </span>
                    {logger && logger !== "stdio" && (
                      <span className="text-gray-600 select-none shrink-0 text-xs">
                        [{logger}]
                      </span>
                    )}
                    <span
                      className={`${colorClass} break-all whitespace-pre-wrap`}
                    >
                      {message}
                    </span>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
      </div>
    </TabsContent>
  );
};

export default ConsoleTab;
