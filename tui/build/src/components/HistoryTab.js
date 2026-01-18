import {
  jsxs as _jsxs,
  jsx as _jsx,
  Fragment as _Fragment,
} from "react/jsx-runtime";
import React, { useState, useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";
import { ScrollView } from "ink-scroll-view";
export function HistoryTab({
  serverName,
  messages,
  width,
  height,
  onCountChange,
  focusedPane = null,
  onViewDetails,
  modalOpen = false,
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [leftScrollOffset, setLeftScrollOffset] = useState(0);
  const scrollViewRef = useRef(null);
  // Calculate visible area for left pane (accounting for header)
  const leftPaneHeight = height - 2; // Subtract header space
  const visibleMessages = messages.slice(
    leftScrollOffset,
    leftScrollOffset + leftPaneHeight,
  );
  const selectedMessage = messages[selectedIndex] || null;
  // Handle arrow key navigation and scrolling when focused
  useInput(
    (input, key) => {
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
  return _jsxs(Box, {
    flexDirection: "row",
    width: width,
    height: height,
    children: [
      _jsxs(Box, {
        width: listWidth,
        height: height,
        borderStyle: "single",
        borderTop: false,
        borderBottom: false,
        borderLeft: false,
        borderRight: true,
        flexDirection: "column",
        paddingX: 1,
        children: [
          _jsx(Box, {
            paddingY: 1,
            flexShrink: 0,
            children: _jsxs(Text, {
              bold: true,
              backgroundColor:
                focusedPane === "messages" ? "yellow" : undefined,
              children: ["Messages (", messages.length, ")"],
            }),
          }),
          messages.length === 0
            ? _jsx(Box, {
                paddingY: 1,
                children: _jsx(Text, {
                  dimColor: true,
                  children: "No messages",
                }),
              })
            : _jsx(Box, {
                flexDirection: "column",
                flexGrow: 1,
                minHeight: 0,
                children: visibleMessages.map((msg, visibleIndex) => {
                  const actualIndex = leftScrollOffset + visibleIndex;
                  const isSelected = actualIndex === selectedIndex;
                  let label;
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
                  return _jsx(
                    Box,
                    {
                      paddingY: 0,
                      children: _jsxs(Text, {
                        color: isSelected ? "white" : "white",
                        children: [
                          isSelected ? "▶ " : "  ",
                          direction,
                          " ",
                          label,
                          hasResponse
                            ? " ✓"
                            : msg.direction === "request"
                              ? " ..."
                              : "",
                        ],
                      }),
                    },
                    msg.id,
                  );
                }),
              }),
        ],
      }),
      _jsx(Box, {
        width: detailWidth,
        height: height,
        paddingX: 1,
        flexDirection: "column",
        flexShrink: 0,
        borderStyle: "single",
        borderTop: false,
        borderBottom: false,
        borderLeft: false,
        borderRight: false,
        children: selectedMessage
          ? _jsxs(_Fragment, {
              children: [
                _jsxs(Box, {
                  flexDirection: "row",
                  justifyContent: "space-between",
                  flexShrink: 0,
                  paddingTop: 1,
                  children: [
                    _jsx(Text, {
                      bold: true,
                      backgroundColor:
                        focusedPane === "details" ? "yellow" : undefined,
                      ...(focusedPane === "details" ? {} : { color: "cyan" }),
                      children:
                        selectedMessage.direction === "request" &&
                        "method" in selectedMessage.message
                          ? selectedMessage.message.method
                          : selectedMessage.direction === "response"
                            ? "Response"
                            : selectedMessage.direction === "notification" &&
                                "method" in selectedMessage.message
                              ? selectedMessage.message.method
                              : "Message",
                    }),
                    _jsx(Text, {
                      dimColor: true,
                      children: selectedMessage.timestamp.toLocaleTimeString(),
                    }),
                  ],
                }),
                _jsxs(ScrollView, {
                  ref: scrollViewRef,
                  height: height - 5,
                  children: [
                    _jsxs(Box, {
                      marginTop: 1,
                      flexDirection: "column",
                      flexShrink: 0,
                      children: [
                        _jsxs(Text, {
                          bold: true,
                          children: ["Direction: ", selectedMessage.direction],
                        }),
                        selectedMessage.duration !== undefined &&
                          _jsx(Box, {
                            marginTop: 1,
                            children: _jsxs(Text, {
                              dimColor: true,
                              children: [
                                "Duration: ",
                                selectedMessage.duration,
                                "ms",
                              ],
                            }),
                          }),
                      ],
                    }),
                    selectedMessage.direction === "request"
                      ? _jsxs(_Fragment, {
                          children: [
                            _jsx(Box, {
                              marginTop: 1,
                              flexShrink: 0,
                              children: _jsx(Text, {
                                bold: true,
                                children: "Request:",
                              }),
                            }),
                            JSON.stringify(selectedMessage.message, null, 2)
                              .split("\n")
                              .map((line, idx) =>
                                _jsx(
                                  Box,
                                  {
                                    marginTop: idx === 0 ? 1 : 0,
                                    paddingLeft: 2,
                                    flexShrink: 0,
                                    children: _jsx(Text, {
                                      dimColor: true,
                                      children: line,
                                    }),
                                  },
                                  `req-${idx}`,
                                ),
                              ),
                            selectedMessage.response
                              ? _jsxs(_Fragment, {
                                  children: [
                                    _jsx(Box, {
                                      marginTop: 1,
                                      flexShrink: 0,
                                      children: _jsx(Text, {
                                        bold: true,
                                        children: "Response:",
                                      }),
                                    }),
                                    JSON.stringify(
                                      selectedMessage.response,
                                      null,
                                      2,
                                    )
                                      .split("\n")
                                      .map((line, idx) =>
                                        _jsx(
                                          Box,
                                          {
                                            marginTop: idx === 0 ? 1 : 0,
                                            paddingLeft: 2,
                                            flexShrink: 0,
                                            children: _jsx(Text, {
                                              dimColor: true,
                                              children: line,
                                            }),
                                          },
                                          `resp-${idx}`,
                                        ),
                                      ),
                                  ],
                                })
                              : _jsx(Box, {
                                  marginTop: 1,
                                  flexShrink: 0,
                                  children: _jsx(Text, {
                                    dimColor: true,
                                    italic: true,
                                    children: "Waiting for response...",
                                  }),
                                }),
                          ],
                        })
                      : _jsxs(_Fragment, {
                          children: [
                            _jsx(Box, {
                              marginTop: 1,
                              flexShrink: 0,
                              children: _jsx(Text, {
                                bold: true,
                                children:
                                  selectedMessage.direction === "response"
                                    ? "Response:"
                                    : "Notification:",
                              }),
                            }),
                            JSON.stringify(selectedMessage.message, null, 2)
                              .split("\n")
                              .map((line, idx) =>
                                _jsx(
                                  Box,
                                  {
                                    marginTop: idx === 0 ? 1 : 0,
                                    paddingLeft: 2,
                                    flexShrink: 0,
                                    children: _jsx(Text, {
                                      dimColor: true,
                                      children: line,
                                    }),
                                  },
                                  `msg-${idx}`,
                                ),
                              ),
                          ],
                        }),
                  ],
                }),
                focusedPane === "details" &&
                  _jsx(Box, {
                    flexShrink: 0,
                    height: 1,
                    justifyContent: "center",
                    backgroundColor: "gray",
                    children: _jsx(Text, {
                      bold: true,
                      color: "white",
                      children: "\u2191/\u2193 to scroll, + to zoom",
                    }),
                  }),
              ],
            })
          : _jsx(Box, {
              paddingY: 1,
              flexShrink: 0,
              children: _jsx(Text, {
                dimColor: true,
                children: "Select a message to view details",
              }),
            }),
      }),
    ],
  });
}
