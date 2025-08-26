import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Trash2, RefreshCw, History } from "lucide-react";
import JsonView from "../JsonView";
import { useMultiServerHistory } from "./hooks/useMultiServerHistory";

interface MultiServerHistoryAndNotificationsProps {
  filteredServerId?: string;
}

export default function MultiServerHistoryAndNotifications({
  filteredServerId,
}: MultiServerHistoryAndNotificationsProps) {
  const {
    allHistory,
    getCombinedHistory,
    clearServerHistory,
    clearAllHistory,
    refreshHistory,
    isLoading,
    error,
  } = useMultiServerHistory();

  const [selectedServer, setSelectedServer] = useState<string>("all");
  const [expandedRequests, setExpandedRequests] = useState<{
    [key: number]: boolean;
  }>({});
  const [expandedNotifications, setExpandedNotifications] = useState<{
    [key: number]: boolean;
  }>({});

  // Auto-select server when filteredServerId is provided and ensure notifications are loaded
  useEffect(() => {
    if (filteredServerId) {
      setSelectedServer(filteredServerId);
      // Force refresh history to ensure notifications are loaded for the specific server
      refreshHistory();
    } else {
      setSelectedServer("all");
    }
  }, [filteredServerId, refreshHistory]);

  // Get combined history entries from the centralized store
  const combinedHistory = getCombinedHistory();

  // Filter history based on selected server
  const filteredHistory =
    selectedServer === "all"
      ? combinedHistory
      : combinedHistory.filter((entry) => entry.serverId === selectedServer);

  // Separate requests and notifications
  const requestEntries = filteredHistory.filter(
    (entry) => entry.type === "request",
  );
  const notificationEntries = filteredHistory.filter(
    (entry) => entry.type === "notification",
  );

  const toggleRequestExpansion = (index: number) => {
    setExpandedRequests((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const toggleNotificationExpansion = (index: number) => {
    setExpandedNotifications((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const handleClearHistory = () => {
    if (selectedServer === "all") {
      clearAllHistory();
    } else {
      clearServerHistory(selectedServer);
    }
  };

  if (error) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            History & Notifications
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-red-500">Error loading history: {error}</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="bg-card overflow-hidden flex h-full flex-col">
      {/* Header with controls */}
      <div className="flex-shrink-0 p-4 border-b">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            History & Notifications
            {filteredServerId && (
              <Badge variant="outline" className="ml-2">
                {allHistory.find((h) => h.serverId === filteredServerId)
                  ?.serverName || "Unknown Server"}
              </Badge>
            )}
          </h2>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={refreshHistory}
              disabled={isLoading}
            >
              <RefreshCw
                className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
              />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearHistory}
              disabled={isLoading}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Server Filter - only show when not filtering to a specific server */}
        {!filteredServerId && (
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium">Filter by server:</label>
            <Select value={selectedServer} onValueChange={setSelectedServer}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Servers</SelectItem>
                {allHistory.map((serverData) => (
                  <SelectItem
                    key={serverData.serverId}
                    value={serverData.serverId}
                  >
                    {serverData.serverName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-hidden">
        <div className="flex h-full">
          {/* Request History */}
          <div className="flex-1 border-r overflow-y-auto p-4">
            <h2 className="text-lg font-semibold mb-4">History</h2>

            {requestEntries.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                No history yet
              </p>
            ) : (
              <ul className="space-y-3">
                {requestEntries.map((entry, index) => {
                  const isExpanded =
                    expandedRequests[requestEntries.length - 1 - index];
                  let requestData;

                  try {
                    requestData = JSON.parse(entry.request || "{}");
                  } catch {
                    requestData = entry.request;
                  }

                  return (
                    <li
                      key={entry.id}
                      className="text-sm text-foreground bg-secondary py-2 px-3 rounded"
                    >
                      <div
                        className="flex items-center justify-between cursor-pointer"
                        onClick={() =>
                          toggleRequestExpansion(
                            requestEntries.length - 1 - index,
                          )
                        }
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm">
                            {requestEntries.length - index}.{" "}
                            {requestData.method || "Unknown Method"}
                          </span>
                          {selectedServer === "all" && (
                            <Badge variant="outline" className="text-xs">
                              {entry.serverName}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">
                            {entry.timestamp.toLocaleTimeString()}
                          </span>
                          <span className="text-xs">
                            {isExpanded ? "▼" : "▶"}
                          </span>
                        </div>
                      </div>

                      {isExpanded && (
                        <>
                          <div className="mt-2">
                            <div className="flex justify-between items-center mb-1">
                              <span className="font-semibold text-blue-600">
                                Request:
                              </span>
                            </div>
                            <JsonView
                              data={entry.request}
                              className="bg-background"
                            />
                          </div>
                          {entry.response && (
                            <div className="mt-2">
                              <div className="flex justify-between items-center mb-1">
                                <span className="font-semibold text-green-600">
                                  Response:
                                </span>
                              </div>
                              <JsonView
                                data={entry.response}
                                className="bg-background"
                              />
                            </div>
                          )}
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Server Notifications */}
          <div className="flex-1 overflow-y-auto p-4">
            <h2 className="text-lg font-semibold mb-4">Server Notifications</h2>

            {notificationEntries.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 italic">
                No notifications yet
              </p>
            ) : (
              <ul className="space-y-3">
                {notificationEntries.map((entry, index) => {
                  const isExpanded =
                    expandedNotifications[
                      notificationEntries.length - 1 - index
                    ];
                  const notification = entry.notification;

                  return (
                    <li
                      key={entry.id}
                      className="text-sm text-foreground bg-secondary py-2 px-3 rounded"
                    >
                      <div
                        className="flex items-center justify-between cursor-pointer"
                        onClick={() =>
                          toggleNotificationExpansion(
                            notificationEntries.length - 1 - index,
                          )
                        }
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-mono">
                            {notificationEntries.length - index}.{" "}
                            {notification?.method || "Unknown Method"}
                          </span>
                          {/* Show log level context for logging notifications */}
                          {selectedServer === "all" && (
                            <Badge variant="outline" className="text-xs">
                              {entry.serverName}
                            </Badge>
                          )}
                        </div>
                        <span>{isExpanded ? "▼" : "▶"}</span>
                      </div>

                      {isExpanded && notification && (
                        <div className="mt-2">
                          <div className="flex justify-between items-center mb-1">
                            <span className="font-semibold text-purple-600">
                              Details:
                            </span>
                            {/* Show additional context for logging messages */}
                          </div>
                          <JsonView
                            data={JSON.stringify(notification, null, 2)}
                            className="bg-background"
                          />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
