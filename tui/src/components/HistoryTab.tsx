import React, { useState, useMemo, useEffect, useRef } from "react";
import { Box, Text, useInput, type Key } from "ink";
import { ScrollView, type ScrollViewRef } from "ink-scroll-view";
import type { MessageEntry } from "../../../shared/mcp/index.js";

interface HistoryTabProps {
  serverName: string | null;
  messages: MessageEntry[];
  width: number;
  height: number;
  onCountChange?: (count: number) => void;
  focusedPane?: "messages" | "details" | null;
  onViewDetails?: (message: MessageEntry) => void;
  modalOpen?: boolean;
}

export function HistoryTab({
  serverName,
  messages,
  width,
  height,
  onCountChange,
  focusedPane = null,
  onViewDetails,
  modalOpen = false,
}: HistoryTabProps) {
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [leftScrollOffset, setLeftScrollOffset] = useState<number>(0);
  const scrollViewRef = useRef<ScrollViewRef>(null);

  // Calculate visible area for left pane (accounting for header)
  const leftPaneHeight = height - 2; // Subtract header space
  const visibleMessages = messages.slice(
    leftScrollOffset,
    leftScrollOffset + leftPaneHeight,
  );

  const selectedMessage = messages[selectedIndex] || null;

  // Handle arrow key navigation and scrolling when focused
  useInput(
    (input: string, key: Key) => {
      if (focusedPane === "messages") {
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
          if (selectedIndex < messages.length - 1) {
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
          const maxScroll = Math.max(0, messages.length - leftPaneHeight);
          setLeftScrollOffset(
            Math.min(maxScroll, leftScrollOffset + leftPaneHeight),
          );
          setSelectedIndex(
            Math.min(messages.length - 1, selectedIndex + leftPaneHeight),
          );
        }
        return;
      }

      // details scrolling (only when details pane is focused)
      if (focusedPane === "details") {
        // Handle '+' key to view in full screen modal
        if (input === "+" && selectedMessage && onViewDetails) {
          onViewDetails(selectedMessage);
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

  // Update count when messages change
  React.useEffect(() => {
    onCountChange?.(messages.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length]);

  // Reset selection when messages change
  useEffect(() => {
    if (selectedIndex >= messages.length) {
      setSelectedIndex(Math.max(0, messages.length - 1));
    }
  }, [messages.length, selectedIndex]);

  // Reset scroll when message selection changes
  useEffect(() => {
    scrollViewRef.current?.scrollTo(0);
  }, [selectedIndex]);

  const listWidth = Math.floor(width * 0.4);
  const detailWidth = width - listWidth;

  return (
    <Box flexDirection="row" width={width} height={height}>
      {/* Left column - Messages list */}
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
            backgroundColor={focusedPane === "messages" ? "yellow" : undefined}
          >
            Messages ({messages.length})
          </Text>
        </Box>

        {/* Messages list */}
        {messages.length === 0 ? (
          <Box paddingY={1}>
            <Text dimColor>No messages</Text>
          </Box>
        ) : (
          <Box flexDirection="column" flexGrow={1} minHeight={0}>
            {visibleMessages.map((msg, visibleIndex) => {
              const actualIndex = leftScrollOffset + visibleIndex;
              const isSelected = actualIndex === selectedIndex;
              let label: string;
              if (msg.direction === "request" && "method" in msg.message) {
                label = msg.message.method;
              } else if (msg.direction === "response") {
                if ("result" in msg.message) {
                  label = "Response (result)";
                } else if ("error" in msg.message) {
                  label = `Response (error: ${msg.message.error.code})`;
                } else {
                  label = "Response";
                }
              } else if (
                msg.direction === "notification" &&
                "method" in msg.message
              ) {
                label = msg.message.method;
              } else {
                label = "Unknown";
              }
              const direction =
                msg.direction === "request"
                  ? "→"
                  : msg.direction === "response"
                    ? "←"
                    : "•";
              const hasResponse = msg.response !== undefined;

              return (
                <Box key={msg.id} paddingY={0}>
                  <Text color={isSelected ? "white" : "white"}>
                    {isSelected ? "▶ " : "  "}
                    {direction} {label}
                    {hasResponse
                      ? " ✓"
                      : msg.direction === "request"
                        ? " ..."
                        : ""}
                  </Text>
                </Box>
              );
            })}
          </Box>
        )}
      </Box>

      {/* Right column - Message details */}
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
        {selectedMessage ? (
          <>
            {/* Fixed method caption only */}
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
                {selectedMessage.direction === "request" &&
                "method" in selectedMessage.message
                  ? selectedMessage.message.method
                  : selectedMessage.direction === "response"
                    ? "Response"
                    : selectedMessage.direction === "notification" &&
                        "method" in selectedMessage.message
                      ? selectedMessage.message.method
                      : "Message"}
              </Text>
              <Text dimColor>
                {selectedMessage.timestamp.toLocaleTimeString()}
              </Text>
            </Box>

            {/* Scrollable content area */}
            <ScrollView ref={scrollViewRef} height={height - 5}>
              {/* Metadata */}
              <Box marginTop={1} flexDirection="column" flexShrink={0}>
                <Text bold>Direction: {selectedMessage.direction}</Text>
                {selectedMessage.duration !== undefined && (
                  <Box marginTop={1}>
                    <Text dimColor>Duration: {selectedMessage.duration}ms</Text>
                  </Box>
                )}
              </Box>

              {selectedMessage.direction === "request" ? (
                <>
                  {/* Request label */}
                  <Box marginTop={1} flexShrink={0}>
                    <Text bold>Request:</Text>
                  </Box>

                  {/* Request content */}
                  {JSON.stringify(selectedMessage.message, null, 2)
                    .split("\n")
                    .map((line: string, idx: number) => (
                      <Box
                        key={`req-${idx}`}
                        marginTop={idx === 0 ? 1 : 0}
                        paddingLeft={2}
                        flexShrink={0}
                      >
                        <Text dimColor>{line}</Text>
                      </Box>
                    ))}

                  {/* Response section */}
                  {selectedMessage.response ? (
                    <>
                      <Box marginTop={1} flexShrink={0}>
                        <Text bold>Response:</Text>
                      </Box>
                      {JSON.stringify(selectedMessage.response, null, 2)
                        .split("\n")
                        .map((line: string, idx: number) => (
                          <Box
                            key={`resp-${idx}`}
                            marginTop={idx === 0 ? 1 : 0}
                            paddingLeft={2}
                            flexShrink={0}
                          >
                            <Text dimColor>{line}</Text>
                          </Box>
                        ))}
                    </>
                  ) : (
                    <Box marginTop={1} flexShrink={0}>
                      <Text dimColor italic>
                        Waiting for response...
                      </Text>
                    </Box>
                  )}
                </>
              ) : (
                <>
                  {/* Response or notification label */}
                  <Box marginTop={1} flexShrink={0}>
                    <Text bold>
                      {selectedMessage.direction === "response"
                        ? "Response:"
                        : "Notification:"}
                    </Text>
                  </Box>

                  {/* Message content */}
                  {JSON.stringify(selectedMessage.message, null, 2)
                    .split("\n")
                    .map((line: string, idx: number) => (
                      <Box
                        key={`msg-${idx}`}
                        marginTop={idx === 0 ? 1 : 0}
                        paddingLeft={2}
                        flexShrink={0}
                      >
                        <Text dimColor>{line}</Text>
                      </Box>
                    ))}
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
            <Text dimColor>Select a message to view details</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
