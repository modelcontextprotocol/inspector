import { useState } from "react";
import JsonView from "./JsonView";
import { Button } from "@/components/ui/button";
import { RequestHistoryEntry } from "@/lib/types/requestHistory";
import { TimestampedNotification } from "@/lib/notificationTypes";
import {
  formatDuration,
  formatTimestamp,
  formatTimestampFull,
} from "@/utils/timeUtils";

const HistoryAndNotifications = ({
  requestHistory,
  serverNotifications,
  onClearHistory,
  onClearNotifications,
}: {
  requestHistory: RequestHistoryEntry[];
  serverNotifications: TimestampedNotification[];
  onClearHistory?: () => void;
  onClearNotifications?: () => void;
}) => {
  const [expandedRequests, setExpandedRequests] = useState<{
    [key: number]: boolean;
  }>({});
  const [expandedNotifications, setExpandedNotifications] = useState<{
    [key: number]: boolean;
  }>({});

  const toggleRequestExpansion = (index: number) => {
    setExpandedRequests((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const toggleNotificationExpansion = (index: number) => {
    setExpandedNotifications((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  return (
    <div className="bg-card overflow-hidden flex h-full">
      <div className="flex-1 overflow-y-auto p-4 border-r">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">History</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={onClearHistory}
            disabled={requestHistory.length === 0}
          >
            Clear
          </Button>
        </div>
        {requestHistory.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 italic">
            No history yet
          </p>
        ) : (
          <ul className="space-y-3">
            {requestHistory
              .slice()
              .reverse()
              .map((entry, index) => (
                <li
                  key={index}
                  className="text-sm text-foreground bg-secondary py-2 px-3 rounded"
                >
                  <div
                    className="flex justify-between items-center cursor-pointer"
                    onClick={() =>
                      toggleRequestExpansion(requestHistory.length - 1 - index)
                    }
                  >
                    <span className="font-mono flex items-center gap-2">
                      {requestHistory.length - index}.{" "}
                      {JSON.parse(entry.request).method}
                      {entry.durationMs !== undefined && (
                        <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded-full">
                          {formatDuration(entry.durationMs)}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {formatTimestamp(entry.requestedAt)}
                      </span>
                      {expandedRequests[requestHistory.length - 1 - index]
                        ? "▼"
                        : "▶"}
                    </span>
                  </div>
                  {expandedRequests[requestHistory.length - 1 - index] && (
                    <>
                      <div className="mt-2 pt-2 border-t border-border">
                        <div className="text-xs text-muted-foreground mb-2 space-y-1">
                          <div>
                            Requested: {formatTimestampFull(entry.requestedAt)}
                          </div>
                          {entry.respondedAt && (
                            <div>
                              Responded:{" "}
                              {formatTimestampFull(entry.respondedAt)}
                              {entry.durationMs !== undefined && (
                                <span className="ml-1">
                                  ({formatDuration(entry.durationMs)})
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
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
              ))}
          </ul>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Server Notifications</h2>
          <Button
            variant="outline"
            size="sm"
            onClick={onClearNotifications}
            disabled={serverNotifications.length === 0}
          >
            Clear
          </Button>
        </div>
        {serverNotifications.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 italic">
            No notifications yet
          </p>
        ) : (
          <ul className="space-y-3">
            {serverNotifications
              .slice()
              .reverse()
              .map((timestamped, index) => (
                <li
                  key={index}
                  className="text-sm text-foreground bg-secondary py-2 px-3 rounded"
                >
                  <div
                    className="flex justify-between items-center cursor-pointer"
                    onClick={() =>
                      toggleNotificationExpansion(
                        serverNotifications.length - 1 - index,
                      )
                    }
                  >
                    <span className="font-mono">
                      {serverNotifications.length - index}.{" "}
                      {timestamped.notification.method}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {formatTimestamp(timestamped.receivedAt)}
                      </span>
                      {expandedNotifications[
                        serverNotifications.length - 1 - index
                      ]
                        ? "▼"
                        : "▶"}
                    </span>
                  </div>
                  {expandedNotifications[
                    serverNotifications.length - 1 - index
                  ] && (
                    <div className="mt-2">
                      <div className="pt-2 border-t border-border">
                        <div className="text-xs text-muted-foreground mb-2">
                          Received:{" "}
                          {formatTimestampFull(timestamped.receivedAt)}
                        </div>
                      </div>
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-semibold text-purple-600">
                          Details:
                        </span>
                      </div>
                      <JsonView
                        data={JSON.stringify(timestamped.notification, null, 2)}
                        className="bg-background"
                      />
                    </div>
                  )}
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default HistoryAndNotifications;
