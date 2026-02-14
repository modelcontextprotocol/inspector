import React, { useEffect, useRef } from "react";
import { Box, Text, useInput, type Key } from "ink";
import { ScrollView, type ScrollViewRef } from "ink-scroll-view";
import type { FetchRequestEntry } from "@modelcontextprotocol/inspector-core/mcp/index.js";
import { useSelectableList } from "../hooks/useSelectableList.js";

interface RequestsTabProps {
  serverName: string | null;
  requests: FetchRequestEntry[];
  width: number;
  height: number;
  onCountChange?: (count: number) => void;
  focusedPane?: "requests" | "details" | null;
  onViewDetails?: (request: FetchRequestEntry) => void;
  modalOpen?: boolean;
}

export function RequestsTab({
  serverName,
  requests,
  width,
  height,
  onCountChange,
  focusedPane = null,
  onViewDetails,
  modalOpen = false,
}: RequestsTabProps) {
  const visibleCount = Math.max(1, height - 7);
  const { selectedIndex, firstVisible, setSelection } = useSelectableList(
    requests.length,
    visibleCount,
  );
  const scrollViewRef = useRef<ScrollViewRef>(null);
  const selectedRequest = requests[selectedIndex] || null;

  // Handle arrow key navigation and scrolling when focused
  useInput(
    (input: string, key: Key) => {
      if (focusedPane === "requests") {
        if (key.upArrow && selectedIndex > 0) {
          setSelection(selectedIndex - 1);
        } else if (key.downArrow && selectedIndex < requests.length - 1) {
          setSelection(selectedIndex + 1);
        } else if (key.pageUp) {
          setSelection(Math.max(0, selectedIndex - visibleCount));
        } else if (key.pageDown) {
          setSelection(
            Math.min(requests.length - 1, selectedIndex + visibleCount),
          );
        }
        return;
      }

      // details scrolling (only when details pane is focused)
      if (focusedPane === "details") {
        // Handle '+' key to view in full screen modal
        if (input === "+" && selectedRequest && onViewDetails) {
          onViewDetails(selectedRequest);
          return;
        }

        if (key.upArrow) {
          scrollViewRef.current?.scrollBy(-1);
        } else if (key.downArrow) {
          scrollViewRef.current?.scrollBy(1);
        } else if (key.pageUp) {
          const viewportHeight =
            scrollViewRef.current?.getViewportHeight() || 1;
          scrollViewRef.current?.scrollBy(-viewportHeight);
        } else if (key.pageDown) {
          const viewportHeight =
            scrollViewRef.current?.getViewportHeight() || 1;
          scrollViewRef.current?.scrollBy(viewportHeight);
        }
      }
    },
    { isActive: !modalOpen && focusedPane !== undefined },
  );

  // Update count when requests change
  React.useEffect(() => {
    onCountChange?.(requests.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requests.length]);

  // Reset details scroll when request selection changes
  useEffect(() => {
    scrollViewRef.current?.scrollTo(0);
  }, [selectedIndex]);

  const listWidth = Math.floor(width * 0.4);
  const detailWidth = width - listWidth;

  const getStatusColor = (status?: number): string => {
    if (!status) return "gray";
    if (status >= 200 && status < 300) return "green";
    if (status >= 300 && status < 400) return "yellow";
    if (status >= 400) return "red";
    return "gray";
  };

  return (
    <Box flexDirection="row" width={width} height={height}>
      {/* Left column - Requests list */}
      <Box
        width={listWidth}
        height={height}
        borderStyle="single"
        borderTop={false}
        borderBottom={false}
        borderLeft={false}
        borderRight={true}
        flexDirection="column"
        paddingX={1}
      >
        <Box paddingY={1} flexShrink={0}>
          <Text
            bold
            backgroundColor={focusedPane === "requests" ? "yellow" : undefined}
          >
            Requests ({requests.length})
          </Text>
        </Box>

        {/* Requests list */}
        {requests.length === 0 ? (
          <Box paddingY={1}>
            <Text dimColor>No requests</Text>
          </Box>
        ) : (
          <Box
            flexDirection="column"
            height={visibleCount}
            overflow="hidden"
            flexShrink={0}
          >
            {requests
              .slice(firstVisible, firstVisible + visibleCount)
              .map((req, i) => {
                const index = firstVisible + i;
                const isSelected = index === selectedIndex;
                const statusColor = getStatusColor(req.responseStatus);
                const statusText = req.responseStatus
                  ? `${req.responseStatus}`
                  : req.error
                    ? "ERROR"
                    : "...";

                const categoryLabel = req.category === "auth" ? "AUTH" : "MCP ";
                const methodPadded = req.method === "GET" ? "GET " : req.method;
                return (
                  <Box key={req.id} paddingY={0} flexShrink={0}>
                    <Text color={isSelected ? "white" : "white"}>
                      {isSelected ? "▶ " : "  "}
                      <Text>{categoryLabel}</Text>{" "}
                      <Text color={statusColor}>{methodPadded}</Text>{" "}
                      <Text dimColor>{statusText}</Text>
                      {req.duration !== undefined && (
                        <Text dimColor> {req.duration}ms</Text>
                      )}
                    </Text>
                  </Box>
                );
              })}
          </Box>
        )}
      </Box>

      {/* Right column - Request details */}
      <Box
        width={detailWidth}
        height={height}
        paddingX={1}
        flexDirection="column"
        flexShrink={0}
        borderStyle="single"
        borderTop={false}
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
      >
        {selectedRequest ? (
          <>
            {/* Fixed header */}
            <Box flexShrink={0} paddingTop={1}>
              <Text
                bold
                backgroundColor={
                  focusedPane === "details" ? "yellow" : undefined
                }
                {...(focusedPane === "details" ? {} : { color: "cyan" })}
              >
                {selectedRequest.method} {selectedRequest.url}
              </Text>
            </Box>

            {/* Scrollable content area */}
            <ScrollView ref={scrollViewRef} height={height - 5}>
              {/* Category */}
              <Box marginTop={1} flexShrink={0}>
                <Text bold>
                  Category:{" "}
                  <Text>
                    {selectedRequest.category === "auth" ? "auth" : "transport"}
                  </Text>
                </Text>
              </Box>

              {/* Status */}
              {selectedRequest.responseStatus !== undefined ? (
                <Box marginTop={1} flexShrink={0}>
                  <Text bold>
                    Status:{" "}
                    <Text
                      color={getStatusColor(selectedRequest.responseStatus)}
                    >
                      {selectedRequest.responseStatus}{" "}
                      {selectedRequest.responseStatusText || ""}
                    </Text>
                  </Text>
                </Box>
              ) : selectedRequest.error ? (
                <Box marginTop={1} flexShrink={0}>
                  <Text bold color="red">
                    Error: {selectedRequest.error}
                  </Text>
                </Box>
              ) : (
                <Box marginTop={1} flexShrink={0}>
                  <Text dimColor italic>
                    Request in progress...
                  </Text>
                </Box>
              )}

              {/* Duration */}
              {selectedRequest.duration !== undefined && (
                <Box marginTop={1} flexShrink={0}>
                  <Text dimColor>
                    {selectedRequest.timestamp.toLocaleTimeString()} (
                    {selectedRequest.duration}ms)
                  </Text>
                </Box>
              )}

              {/* Request Headers */}
              <Box marginTop={1} flexShrink={0}>
                <Text bold>Request Headers:</Text>
              </Box>
              {Object.entries(selectedRequest.requestHeaders).map(
                ([key, value]) => (
                  <Box key={key} marginTop={0} paddingLeft={2} flexShrink={0}>
                    <Text dimColor>
                      {key}: {value}
                    </Text>
                  </Box>
                ),
              )}

              {/* Request Body */}
              {selectedRequest.requestBody && (
                <>
                  <Box marginTop={1} flexShrink={0}>
                    <Text bold>Request Body:</Text>
                  </Box>
                  {(() => {
                    try {
                      const parsed = JSON.parse(selectedRequest.requestBody);
                      return JSON.stringify(parsed, null, 2)
                        .split("\n")
                        .map((line: string, idx: number) => (
                          <Box
                            key={`req-body-${idx}`}
                            marginTop={idx === 0 ? 1 : 0}
                            paddingLeft={2}
                            flexShrink={0}
                          >
                            <Text dimColor>{line}</Text>
                          </Box>
                        ));
                    } catch {
                      return (
                        <Box marginTop={1} paddingLeft={2} flexShrink={0}>
                          <Text dimColor>{selectedRequest.requestBody}</Text>
                        </Box>
                      );
                    }
                  })()}
                </>
              )}

              {/* Response Headers */}
              {selectedRequest.responseHeaders &&
                Object.keys(selectedRequest.responseHeaders).length > 0 && (
                  <>
                    <Box marginTop={1} flexShrink={0}>
                      <Text bold>Response Headers:</Text>
                    </Box>
                    {Object.entries(selectedRequest.responseHeaders).map(
                      ([key, value]) => (
                        <Box
                          key={key}
                          marginTop={0}
                          paddingLeft={2}
                          flexShrink={0}
                        >
                          <Text dimColor>
                            {key}: {value}
                          </Text>
                        </Box>
                      ),
                    )}
                  </>
                )}

              {/* Response Body */}
              {selectedRequest.responseBody && (
                <>
                  <Box marginTop={1} flexShrink={0}>
                    <Text bold>Response Body:</Text>
                  </Box>
                  {(() => {
                    try {
                      const parsed = JSON.parse(selectedRequest.responseBody);
                      return JSON.stringify(parsed, null, 2)
                        .split("\n")
                        .map((line: string, idx: number) => (
                          <Box
                            key={`resp-body-${idx}`}
                            marginTop={idx === 0 ? 1 : 0}
                            paddingLeft={2}
                            flexShrink={0}
                          >
                            <Text dimColor>{line}</Text>
                          </Box>
                        ));
                    } catch {
                      return (
                        <Box marginTop={1} paddingLeft={2} flexShrink={0}>
                          <Text dimColor>{selectedRequest.responseBody}</Text>
                        </Box>
                      );
                    }
                  })()}
                </>
              )}
            </ScrollView>

            {/* Fixed footer - only show when details pane is focused */}
            {focusedPane === "details" && (
              <Box flexShrink={0} height={1} justifyContent="center">
                <Text bold color="white">
                  ↑/↓ to scroll, + to zoom
                </Text>
              </Box>
            )}
          </>
        ) : (
          <Box paddingY={1} flexShrink={0}>
            <Text dimColor>Select a request to view details</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
