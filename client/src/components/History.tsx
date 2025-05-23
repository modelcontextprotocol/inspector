import {
  CallToolResultSchema,
  CompatibilityCallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { useEffect, useState } from "react";
import { Activity, History } from "lucide-react";
import JsonView from "./JsonView";
import { useDraggablePane } from "../lib/hooks/useDraggablePane";

const HistoryAndNotifications = ({
  requestHistory,
  toolResult,
}: {
  requestHistory: Array<{ request: string; response?: string }>;
  toolResult: CompatibilityCallToolResult | null;
}) => {
  const [expandedRequests, setExpandedRequests] = useState<{
    [key: number]: boolean;
  }>({});
  const [isHistoryCollapsed, setIsHistoryCollapsed] = useState(false);

  const { height: historyPaneHeight, handleDragStart } = useDraggablePane(
    isHistoryCollapsed ? 60 : 350,
  );

  const toggleRequestExpansion = (index: number) => {
    setExpandedRequests((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  useEffect(() => {
    if (toolResult) {
      setIsHistoryCollapsed(false);
    }
  }, [toolResult]);

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
      className={`relative bg-gradient-to-r from-card/95 via-card to-card/95 backdrop-blur-md border-t border-border/30 transition-all duration-500 ease-out ${
        isHistoryCollapsed
          ? "shadow-lg shadow-black/5"
          : "shadow-2xl shadow-black/10"
      }`}
      style={{
        height: `${isHistoryCollapsed ? 60 : historyPaneHeight}px`,
      }}
    >
      {/* Prominent Centered Drag Handle */}
      <div
        className="absolute w-full h-8 -top-4 cursor-row-resize flex items-center justify-center group transition-all duration-300 hover:bg-accent/30 rounded-t-xl"
        onMouseDown={handleDragStart}
      >
        <div className="flex items-center justify-center w-full relative">
          {isHistoryCollapsed ? null : (
            <button
              onClick={() => setIsHistoryCollapsed(!isHistoryCollapsed)}
              className="p-2 rounded-lg hover:bg-accent/80 active:bg-accent transition-all duration-200 group/btn border border-border/20 bg-background/50 backdrop-blur-sm shadow-sm"
            >
              <>
                <span className="text-xs text-muted-foreground group-hover/btn:text-foreground font-medium">
                  Collapse
                </span>
              </>
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="h-full overflow-hidden">
        {!isHistoryCollapsed ? (
          <div className="bg-transparent flex h-full">
            <div className="flex-1 overflow-y-auto p-6 border-r border-border/20">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-bold text-foreground flex items-center space-x-2">
                  <Activity className="w-5 h-5 text-primary" />
                  <span>All Activity</span>
                </h2>
                {requestHistory.length > 0 && (
                  <span className="text-sm text-muted-foreground bg-muted/50 px-3 py-1 rounded-full">
                    {requestHistory.length} request
                    {requestHistory.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>

              {requestHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Activity className="w-12 h-12 text-muted-foreground/40 mb-4" />
                  <p className="text-muted-foreground text-lg font-medium mb-2">
                    No activity yet
                  </p>
                  <p className="text-muted-foreground/60 text-sm">
                    MCP requests and responses will appear here
                  </p>
                </div>
              ) : (
                <ul className="space-y-4">
                  {requestHistory
                    .slice()
                    .reverse()
                    .map((request, index) => (
                      <li
                        key={index}
                        className="text-sm bg-gradient-to-r from-secondary/50 via-secondary/70 to-secondary/50 backdrop-blur-sm p-4 rounded-xl border border-border/30 hover:border-border/60 transition-all duration-200 hover:shadow-lg"
                      >
                        <div
                          className="flex justify-between items-center cursor-pointer group"
                          onClick={() =>
                            toggleRequestExpansion(
                              requestHistory.length - 1 - index,
                            )
                          }
                        >
                          <div className="flex items-center space-x-3">
                            <span className="flex items-center justify-center w-6 h-6 bg-primary/10 text-primary text-xs font-bold rounded-full">
                              {requestHistory.length - index}
                            </span>
                            <span className="font-mono font-semibold text-foreground">
                              {JSON.parse(request.request).method}
                            </span>
                          </div>
                          <span className="text-muted-foreground group-hover:text-foreground transition-colors duration-200">
                            {expandedRequests[requestHistory.length - 1 - index]
                              ? "▼"
                              : "▶"}
                          </span>
                        </div>
                        {expandedRequests[
                          requestHistory.length - 1 - index
                        ] && (
                          <div className="mt-4 space-y-4">
                            <div>
                              <div className="flex items-center mb-2">
                                <span className="font-semibold text-foreground text-sm">
                                  Request
                                </span>
                              </div>
                              <JsonView
                                data={request.request}
                                className="bg-background/80 backdrop-blur-sm border border-border/20 rounded-lg"
                              />
                            </div>
                            {request.response && (
                              <div>
                                <div className="flex items-center mb-2">
                                  <span className="font-semibold text-foreground text-sm">
                                    Response
                                  </span>
                                </div>
                                <JsonView
                                  data={request.response}
                                  className="bg-background/80 backdrop-blur-sm border border-border/20 rounded-lg"
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </li>
                    ))}
                </ul>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-bold text-foreground flex items-center space-x-2">
                  <div className="w-5 h-5 rounded bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center">
                    <span className="text-white text-xs">✓</span>
                  </div>
                  <span>Results</span>
                </h2>
              </div>

              {!toolResult ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="w-12 h-12 rounded-full bg-muted/20 flex items-center justify-center mb-4">
                    <span className="text-2xl">🎯</span>
                  </div>
                  <p className="text-muted-foreground text-lg font-medium mb-2">
                    No results yet
                  </p>
                  <p className="text-muted-foreground/60 text-sm">
                    Tool execution results will appear here
                  </p>
                </div>
              ) : (
                <div className="bg-gradient-to-br from-background/80 to-background/60 backdrop-blur-sm p-4 rounded-xl border border-border/30">
                  {renderToolResult()}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div
            className="h-full flex items-center justify-center bg-gradient-to-r from-muted/20 via-muted/30 to-muted/20 bg-slate-200 cursor-pointer hover:bg-gradient-to-r hover:from-muted/30 hover:via-muted/40 hover:to-muted/30 transition-all duration-200"
            onClick={() => setIsHistoryCollapsed(!isHistoryCollapsed)}
          >
            <div className="flex items-center space-x-4 text-muted-foreground">
              <History className="w-5 h-5" />
              <span className="text-sm font-medium">History & Results</span>
              {requestHistory.length > 0 && (
                <span className="px-2 py-1 text-xs bg-primary/10 text-primary rounded-full">
                  {requestHistory.length}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default HistoryAndNotifications;
