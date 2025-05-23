import {
  CallToolResultSchema,
  CompatibilityCallToolResult,
  ServerNotification,
} from "@modelcontextprotocol/sdk/types.js";
import { useState } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import JsonView from "./JsonView";
import { useDraggablePane } from "../lib/hooks/useDraggablePane";

const HistoryAndNotifications = ({
  requestHistory,
  serverNotifications,
  toolResult,
}: {
  requestHistory: Array<{ request: string; response?: string }>;
  serverNotifications: ServerNotification[];
  toolResult: CompatibilityCallToolResult | null;
}) => {
  const [expandedRequests, setExpandedRequests] = useState<{
    [key: number]: boolean;
  }>({});
  const [expandedNotifications, setExpandedNotifications] = useState<{
    [key: number]: boolean;
  }>({});
  const [isHistoryCollapsed, setIsHistoryCollapsed] = useState(false);

  const { height: historyPaneHeight, handleDragStart } = useDraggablePane(
    isHistoryCollapsed ? 50 : 200,
  );

  const toggleRequestExpansion = (index: number) => {
    setExpandedRequests((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const toggleNotificationExpansion = (index: number) => {
    setExpandedNotifications((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  // TODO: Figure out how to show server notifications in a clean way
  const renderServerNotifications = () => {
    return serverNotifications.length === 0 ? (
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
                  {serverNotifications.length - index}. {notification.method}
                </span>
                <span>{expandedNotifications[index] ? "▼" : "▶"}</span>
              </div>
              {expandedNotifications[index] && (
                <div className="mt-2">
                  <div className="flex justify-between items-center mb-1">
                    <span className="font-semibold text-black">Details:</span>
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
    );
  };

  const renderToolResult = () => {
    if (!toolResult) return null;

    if ("content" in toolResult) {
      const parsedResult = CallToolResultSchema.safeParse(toolResult);
      if (!parsedResult.success) {
        return (
          <>
            <h4 className="font-semibold mb-2">Invalid Tool Result:</h4>
            <JsonView data={toolResult} />
            <h4 className="font-semibold mb-2">Errors:</h4>
            {parsedResult.error.errors.map((error, idx) => (
              <JsonView data={error} key={idx} />
            ))}
          </>
        );
      }
      const structuredResult = parsedResult.data;
      const isError = structuredResult.isError ?? false;

      return (
        <>
          <h4 className="font-semibold mb-2">
            Tool Result:{" "}
            {isError ? (
              <span className="text-red-600 font-semibold">Error</span>
            ) : (
              <span className="text-green-600 font-semibold">Success</span>
            )}
          </h4>
          {structuredResult.content.map((item, index) => (
            <div key={index} className="mb-2">
              {item.type === "text" && (
                <JsonView data={item.text} isError={isError} />
              )}
              {item.type === "image" && (
                <img
                  src={`data:${item.mimeType};base64,${item.data}`}
                  alt="Tool result image"
                  className="max-w-full h-auto"
                />
              )}
              {item.type === "resource" &&
                (item.resource?.mimeType?.startsWith("audio/") ? (
                  <audio
                    controls
                    src={`data:${item.resource.mimeType};base64,${item.resource.blob}`}
                    className="w-full"
                  >
                    <p>Your browser does not support audio playback</p>
                  </audio>
                ) : (
                  <JsonView data={item.resource} />
                ))}
            </div>
          ))}
        </>
      );
    } else if ("toolResult" in toolResult) {
      return (
        <>
          <h4 className="font-semibold mb-2">Tool Result (Legacy):</h4>

          <JsonView data={toolResult.toolResult} />
        </>
      );
    }
  };

  return (
    <div
      className={`relative bg-card border-t border-border/50 shadow-lg transition-all duration-300 ${
        isHistoryCollapsed ? "shadow-sm" : "shadow-xl"
      }`}
      style={{
        height: `${isHistoryCollapsed ? 50 : historyPaneHeight}px`,
      }}
    >
      {/* Drag Handle */}
      <div
        className="absolute w-full h-6 -top-3 cursor-row-resize flex items-center justify-center group hover:bg-accent/30 transition-colors duration-200"
        onMouseDown={handleDragStart}
      >
        <div className="flex items-center space-x-1">
          <div className="w-8 h-1.5 rounded-full bg-border group-hover:bg-border/80 transition-colors duration-200" />
          <button
            onClick={() => setIsHistoryCollapsed(!isHistoryCollapsed)}
            className="p-1 rounded-md hover:bg-accent transition-colors duration-200"
          >
            {isHistoryCollapsed ? (
              <ChevronUp className="w-3 h-3 text-muted-foreground" />
            ) : (
              <ChevronDown className="w-3 h-3 text-muted-foreground" />
            )}
          </button>
        </div>
      </div>

      {/* History and Results */}
      <div className="h-full overflow-auto">
        {!isHistoryCollapsed && (
          <div className="bg-card overflow-hidden flex h-full">
            <div className="flex-1 overflow-y-auto p-4 border-r">
              <h2 className="text-lg font-semibold mb-4">All Activity</h2>
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
                            toggleRequestExpansion(
                              requestHistory.length - 1 - index,
                            )
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
                        {expandedRequests[
                          requestHistory.length - 1 - index
                        ] && (
                          <>
                            <div className="mt-2">
                              <div className="flex justify-between items-center mb-1">
                                <span className="font-semibold text-black">
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
                                  <span className="font-semibold text-black">
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
              <h2 className="text-lg font-semibold mb-4">Results</h2>
              {renderToolResult()}
            </div>
          </div>
        )}
        {isHistoryCollapsed && (
          <div className="h-full flex items-center justify-center">
            <span className="text-sm text-muted-foreground">
              History & Notifications
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default HistoryAndNotifications;
