import React, { useState, useMemo, useEffect, useRef } from "react";
import { Box, Text, useInput, type Key } from "ink";
import { ScrollView, type ScrollViewRef } from "ink-scroll-view";
import type { FetchRequestEntry } from "@modelcontextprotocol/inspector-shared/mcp/index.js";

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
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [leftScrollOffset, setLeftScrollOffset] = useState<number>(0);
  const scrollViewRef = useRef<ScrollViewRef>(null);

  // Calculate visible area for left pane (accounting for header)
  const leftPaneHeight = height - 2; // Subtract header space
  const visibleRequests = requests.slice(
    leftScrollOffset,
    leftScrollOffset + leftPaneHeight,
  );

  const selectedRequest = requests[selectedIndex] || null;

  // Handle arrow key navigation and scrolling when focused
  useInput(
    (input: string, key: Key) => {
      if (focusedPane === "requests") {
        if (key.upArrow) {
          if (selectedIndex > 0) {
            const newIndex = selectedIndex - 1;
            setSelectedIndex(newIndex);
            // Auto-scroll if selection goes above visible area
            if (newIndex < leftScrollOffset) {
              setLeftScrollOffset(newIndex);
            }
          }
        } else if (key.downArrow) {
          if (selectedIndex < requests.length - 1) {
            const newIndex = selectedIndex + 1;
            setSelectedIndex(newIndex);
            // Auto-scroll if selection goes below visible area
            if (newIndex >= leftScrollOffset + leftPaneHeight) {
              setLeftScrollOffset(Math.max(0, newIndex - leftPaneHeight + 1));
            }
          }
        } else if (key.pageUp) {
          setLeftScrollOffset(Math.max(0, leftScrollOffset - leftPaneHeight));
          setSelectedIndex(Math.max(0, selectedIndex - leftPaneHeight));
        } else if (key.pageDown) {
          const maxScroll = Math.max(0, requests.length - leftPaneHeight);
          setLeftScrollOffset(
            Math.min(maxScroll, leftScrollOffset + leftPaneHeight),
          );
          setSelectedIndex(
            Math.min(requests.length - 1, selectedIndex + leftPaneHeight),
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

  // Reset selection when requests change
  useEffect(() => {
    if (selectedIndex >= requests.length) {
      setSelectedIndex(Math.max(0, requests.length - 1));
    }
  }, [requests.length, selectedIndex]);

  // Reset scroll when request selection changes
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
          <Box flexDirection="column" flexGrow={1} minHeight={0}>
            {visibleRequests.map((req, visibleIndex) => {
              const actualIndex = leftScrollOffset + visibleIndex;
              const isSelected = actualIndex === selectedIndex;
              const statusColor = getStatusColor(req.responseStatus);
              const statusText = req.responseStatus
                ? `${req.responseStatus}`
                : req.error
                  ? "ERROR"
                  : "...";

              return (
                <Box key={req.id} paddingY={0}>
                  <Text color={isSelected ? "white" : "white"}>
                    {isSelected ? "▶ " : "  "}
                    <Text color={statusColor}>{req.method}</Text>{" "}
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
            <Box
              flexDirection="row"
              justifyContent="space-between"
              flexShrink={0}
              paddingTop={1}
            >
              <Text
                bold
                backgroundColor={
                  focusedPane === "details" ? "yellow" : undefined
                }
                {...(focusedPane === "details" ? {} : { color: "cyan" })}
              >
                {selectedRequest.method} {selectedRequest.url}
              </Text>
              <Text dimColor>
                {selectedRequest.timestamp.toLocaleTimeString()}
              </Text>
            </Box>

            {/* Scrollable content area */}
            <ScrollView ref={scrollViewRef} height={height - 5}>
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
                  <Text dimColor>Duration: {selectedRequest.duration}ms</Text>
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
              <Box
                flexShrink={0}
                height={1}
                justifyContent="center"
                backgroundColor="gray"
              >
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
