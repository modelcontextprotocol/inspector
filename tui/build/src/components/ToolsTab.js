import {
  jsxs as _jsxs,
  jsx as _jsx,
  Fragment as _Fragment,
} from "react/jsx-runtime";
import { useState, useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";
import { ScrollView } from "ink-scroll-view";
export function ToolsTab({
  tools,
  client,
  width,
  height,
  onCountChange,
  focusedPane = null,
  onTestTool,
  onViewDetails,
  modalOpen = false,
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState(null);
  const scrollViewRef = useRef(null);
  const listWidth = Math.floor(width * 0.4);
  const detailWidth = width - listWidth;
  // Handle arrow key navigation when focused
  useInput(
    (input, key) => {
      // Handle Enter key to test tool (works from both list and details)
      if (key.return && selectedTool && client && onTestTool) {
        onTestTool(selectedTool);
        return;
      }
      if (focusedPane === "list") {
        // Navigate the list
        if (key.upArrow && selectedIndex > 0) {
          setSelectedIndex(selectedIndex - 1);
        } else if (key.downArrow && selectedIndex < tools.length - 1) {
          setSelectedIndex(selectedIndex + 1);
        }
        return;
      }
      if (focusedPane === "details") {
        // Handle '+' key to view in full screen modal
        if (input === "+" && selectedTool && onViewDetails) {
          onViewDetails(selectedTool);
          return;
        }
        // Scroll the details pane using ink-scroll-view
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
    {
      isActive:
        !modalOpen && (focusedPane === "list" || focusedPane === "details"),
    },
  );
  // Helper to calculate content lines for a tool
  const calculateToolContentLines = (tool) => {
    let lines = 1; // Name
    if (tool.description) lines += tool.description.split("\n").length + 1;
    if (tool.inputSchema) {
      const schemaStr = JSON.stringify(tool.inputSchema, null, 2);
      lines += schemaStr.split("\n").length + 2; // +2 for "Input Schema:" label
    }
    return lines;
  };
  // Reset scroll when selection changes
  useEffect(() => {
    scrollViewRef.current?.scrollTo(0);
  }, [selectedIndex]);
  // Reset selected index when tools array changes (different server)
  useEffect(() => {
    setSelectedIndex(0);
  }, [tools]);
  const selectedTool = tools[selectedIndex] || null;
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
            children: _jsxs(Text, {
              bold: true,
              backgroundColor: focusedPane === "list" ? "yellow" : undefined,
              children: ["Tools (", tools.length, ")"],
            }),
          }),
          error
            ? _jsx(Box, {
                paddingY: 1,
                children: _jsx(Text, { color: "red", children: error }),
              })
            : tools.length === 0
              ? _jsx(Box, {
                  paddingY: 1,
                  children: _jsx(Text, {
                    dimColor: true,
                    children: "No tools available",
                  }),
                })
              : _jsx(Box, {
                  flexDirection: "column",
                  flexGrow: 1,
                  children: tools.map((tool, index) => {
                    const isSelected = index === selectedIndex;
                    return _jsx(
                      Box,
                      {
                        paddingY: 0,
                        children: _jsxs(Text, {
                          children: [
                            isSelected ? "▶ " : "  ",
                            tool.name || `Tool ${index + 1}`,
                          ],
                        }),
                      },
                      tool.name || index,
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
        overflow: "hidden",
        children: selectedTool
          ? _jsxs(_Fragment, {
              children: [
                _jsxs(Box, {
                  flexShrink: 0,
                  flexDirection: "row",
                  justifyContent: "space-between",
                  paddingTop: 1,
                  children: [
                    _jsx(Text, {
                      bold: true,
                      backgroundColor:
                        focusedPane === "details" ? "yellow" : undefined,
                      ...(focusedPane === "details" ? {} : { color: "cyan" }),
                      children: selectedTool.name,
                    }),
                    client &&
                      _jsx(Text, {
                        children: _jsx(Text, {
                          color: "cyan",
                          bold: true,
                          children: "[Enter to Test]",
                        }),
                      }),
                  ],
                }),
                _jsxs(ScrollView, {
                  ref: scrollViewRef,
                  height: height - 5,
                  children: [
                    selectedTool.description &&
                      _jsx(_Fragment, {
                        children: selectedTool.description
                          .split("\n")
                          .map((line, idx) =>
                            _jsx(
                              Box,
                              {
                                marginTop: idx === 0 ? 1 : 0,
                                flexShrink: 0,
                                children: _jsx(Text, {
                                  dimColor: true,
                                  children: line,
                                }),
                              },
                              `desc-${idx}`,
                            ),
                          ),
                      }),
                    selectedTool.inputSchema &&
                      _jsxs(_Fragment, {
                        children: [
                          _jsx(Box, {
                            marginTop: 1,
                            flexShrink: 0,
                            children: _jsx(Text, {
                              bold: true,
                              children: "Input Schema:",
                            }),
                          }),
                          JSON.stringify(selectedTool.inputSchema, null, 2)
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
                                `schema-${idx}`,
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
                children: "Select a tool to view details",
              }),
            }),
      }),
    ],
  });
}
