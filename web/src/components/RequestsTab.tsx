import { TabsContent } from "@/components/ui/tabs";
import JsonView from "./JsonView";
import type { FetchRequestEntry } from "@modelcontextprotocol/inspector-shared/mcp/index.js";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface RequestsTabProps {
  fetchRequests: FetchRequestEntry[];
}

const RequestsTab = ({ fetchRequests }: RequestsTabProps) => {
  const [expandedRequests, setExpandedRequests] = useState<{
    [key: string]: boolean;
  }>({});

  const toggleRequestExpansion = (id: string) => {
    setExpandedRequests((prev) => ({ ...prev, [id]: !prev[id] }));
  };

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

  const getStatusColor = (status?: number, error?: string) => {
    if (error) return "text-red-600 dark:text-red-400";
    if (!status) return "text-gray-500";
    if (status >= 200 && status < 300)
      return "text-green-600 dark:text-green-400";
    if (status >= 300 && status < 400)
      return "text-yellow-600 dark:text-yellow-400";
    if (status >= 400) return "text-red-600 dark:text-red-400";
    return "text-gray-500";
  };

  const getCategoryBadge = (category: "auth" | "transport") => {
    const isAuth = category === "auth";
    return (
      <span
        className={`px-2 py-1 rounded text-xs font-semibold ${
          isAuth
            ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
            : "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200"
        }`}
      >
        {isAuth ? "AUTH" : "MCP"}
      </span>
    );
  };

  return (
    <TabsContent value="requests" className="flex-1 flex flex-col min-h-0 mt-0">
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between mb-4 flex-shrink-0">
          <h2 className="text-lg font-semibold">HTTP Requests</h2>
          <div className="text-sm text-muted-foreground">
            {fetchRequests.length} request
            {fetchRequests.length !== 1 ? "s" : ""}
          </div>
        </div>
        {fetchRequests.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 italic flex-shrink-0">
            No HTTP requests yet
          </p>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="space-y-2">
              {fetchRequests
                .slice()
                .reverse()
                .map((request) => (
                  <div
                    key={request.id}
                    className="text-sm text-foreground bg-secondary border border-border rounded-lg overflow-hidden"
                  >
                    <div
                      className="flex items-center justify-between p-3 cursor-pointer hover:bg-accent/50 transition-colors"
                      onClick={() => toggleRequestExpansion(request.id)}
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        {expandedRequests[request.id] ? (
                          <ChevronDown className="w-4 h-4 flex-shrink-0" />
                        ) : (
                          <ChevronRight className="w-4 h-4 flex-shrink-0" />
                        )}
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {getCategoryBadge(request.category)}
                        </div>
                        <span className="font-mono font-semibold text-xs flex-shrink-0">
                          {request.method}
                        </span>
                        <span
                          className={`font-mono text-xs flex-shrink-0 ${getStatusColor(
                            request.responseStatus,
                            request.error,
                          )}`}
                        >
                          {request.error
                            ? "ERROR"
                            : request.responseStatus
                              ? `${request.responseStatus}${request.responseStatusText ? ` ${request.responseStatusText}` : ""}`
                              : "PENDING"}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground truncate flex-1 min-w-0">
                          {request.url}
                        </span>
                        {request.duration !== undefined && (
                          <span className="text-xs text-muted-foreground flex-shrink-0">
                            {request.duration}ms
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground flex-shrink-0">
                          {formatTimestamp(request.timestamp)}
                        </span>
                      </div>
                    </div>
                    {expandedRequests[request.id] && (
                      <div className="border-t border-border p-4 space-y-4 bg-background/50">
                        {/* Request Details */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-semibold text-blue-600 dark:text-blue-400">
                              Request
                            </span>
                          </div>
                          <div className="space-y-2">
                            <div>
                              <span className="text-xs font-semibold text-muted-foreground">
                                URL:
                              </span>
                              <div className="font-mono text-xs break-all mt-1">
                                {request.url}
                              </div>
                            </div>
                            <div>
                              <span className="text-xs font-semibold text-muted-foreground">
                                Method:
                              </span>
                              <div className="font-mono text-xs mt-1">
                                {request.method}
                              </div>
                            </div>
                            {Object.keys(request.requestHeaders).length > 0 && (
                              <div>
                                <span className="text-xs font-semibold text-muted-foreground">
                                  Headers:
                                </span>
                                <JsonView
                                  data={request.requestHeaders}
                                  className="bg-background mt-1"
                                  initialExpandDepth={2}
                                />
                              </div>
                            )}
                            {request.requestBody && (
                              <div>
                                <span className="text-xs font-semibold text-muted-foreground">
                                  Body:
                                </span>
                                <JsonView
                                  data={request.requestBody}
                                  className="bg-background mt-1"
                                  initialExpandDepth={2}
                                />
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Response Details */}
                        {request.error ? (
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <span className="font-semibold text-red-600 dark:text-red-400">
                                Error
                              </span>
                            </div>
                            <div className="text-sm text-red-600 dark:text-red-400">
                              {request.error}
                            </div>
                          </div>
                        ) : (
                          request.responseStatus !== undefined && (
                            <div>
                              <div className="flex items-center justify-between mb-2">
                                <span className="font-semibold text-green-600 dark:text-green-400">
                                  Response
                                </span>
                              </div>
                              <div className="space-y-2">
                                <div>
                                  <span className="text-xs font-semibold text-muted-foreground">
                                    Status:
                                  </span>
                                  <div className="font-mono text-xs mt-1">
                                    {request.responseStatus}
                                    {request.responseStatusText
                                      ? ` ${request.responseStatusText}`
                                      : ""}
                                  </div>
                                </div>
                                {request.responseHeaders &&
                                  Object.keys(request.responseHeaders).length >
                                    0 && (
                                    <div>
                                      <span className="text-xs font-semibold text-muted-foreground">
                                        Headers:
                                      </span>
                                      <JsonView
                                        data={request.responseHeaders}
                                        className="bg-background mt-1"
                                        initialExpandDepth={2}
                                      />
                                    </div>
                                  )}
                                {request.responseBody && (
                                  <div>
                                    <span className="text-xs font-semibold text-muted-foreground">
                                      Body:
                                    </span>
                                    <JsonView
                                      data={request.responseBody}
                                      className="bg-background mt-1"
                                      initialExpandDepth={2}
                                    />
                                  </div>
                                )}
                                {request.duration !== undefined && (
                                  <div>
                                    <span className="text-xs font-semibold text-muted-foreground">
                                      Duration:
                                    </span>
                                    <div className="font-mono text-xs mt-1">
                                      {request.duration}ms
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          )
                        )}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </TabsContent>
  );
};

export default RequestsTab;
