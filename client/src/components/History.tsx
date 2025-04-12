import { ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import { useState } from "react";
import JsonView from "./JsonView";

const HistoryAndNotifications = ({
  requestHistory,
  serverNotifications,
}: {
  requestHistory: Array<{ request: string; response?: string }>;
  serverNotifications: ServerNotification[];
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
        <h2 className="text-lg font-semibold mb-4">History</h2>
        {requestHistory.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No history yet</p>
        ) : (
          <ul className="space-y-3">
            {requestHistory
              .slice()
              .reverse()
              .map((request, index) => (
                <li
                  key={index}
                  className="text-sm text-foreground bg-secondary p-2 rounded"
                >
                  <div
                    className="flex justify-between items-center cursor-pointer"
                    onClick={() =>
                      toggleRequestExpansion(requestHistory.length - 1 - index)
                    }
                  >
                    <span className="font-mono">
                      {requestHistory.length - index}.{" "}
                      {JSON.parse(request.request).method}
                    </span>
                    <span>
                      {expandedRequests[requestHistory.length - 1 - index]
                        ? "▼"
                        : "▶"}
                    </span>
                  </div>
                  {expandedRequests[requestHistory.length - 1 - index] && (
                    <>
                      <div className="mt-2">
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-semibold text-blue-600">
                            Request:
                          </span>
                        </div>

                        <JsonView
                          data={request.request}
                          className="bg-background"
                        />
                      </div>
                      {request.response && (
                        <div className="mt-2">
                          <div className="flex justify-between items-center mb-1">
                            <span className="font-semibold text-green-600">
                              Response:
                            </span>
                          </div>
                          <JsonView
                            data={request.response}
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
        <h2 className="text-lg font-semibold mb-4">Server Notifications</h2>
        {serverNotifications.length === 0 ? (
          <p className="text-sm text-gray-500 italic">No notifications yet</p>
        ) : (
          <ul className="space-y-3">
            {serverNotifications
              .slice()
              .reverse()
              .map((notification, index) => (
                <li
                  key={index}
                  className="text-sm text-foreground bg-secondary p-2 rounded"
                >
                  <div
                    className="flex justify-between items-center cursor-pointer"
                    onClick={() => toggleNotificationExpansion(index)}
                  >
                    <span className="font-mono">
                      {serverNotifications.length - index}.{" "}
                      {notification.method}
                    </span>
                    <span>{expandedNotifications[index] ? "▼" : "▶"}</span>
                  </div>
                  {expandedNotifications[index] && (
                    <div className="mt-2">
                      <div className="flex justify-between items-center mb-1">
                        <span className="font-semibold text-purple-600">
                          Details:
                        </span>
                      </div>
                      <JsonView
                        data={JSON.stringify(notification, null, 2)}
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
