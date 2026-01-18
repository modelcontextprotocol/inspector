import {
  jsxs as _jsxs,
  jsx as _jsx,
  Fragment as _Fragment,
} from "react/jsx-runtime";
import { useState, useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";
import { ScrollView } from "ink-scroll-view";
export function PromptsTab({
  prompts,
  client,
  width,
  height,
  onCountChange,
  focusedPane = null,
  onViewDetails,
  modalOpen = false,
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState(null);
  const scrollViewRef = useRef(null);
  // Handle arrow key navigation when focused
  useInput(
    (input, key) => {
      if (focusedPane === "list") {
        // Navigate the list
        if (key.upArrow && selectedIndex > 0) {
          setSelectedIndex(selectedIndex - 1);
        } else if (key.downArrow && selectedIndex < prompts.length - 1) {
          setSelectedIndex(selectedIndex + 1);
        }
        return;
      }
      if (focusedPane === "details") {
        // Handle '+' key to view in full screen modal
        if (input === "+" && selectedPrompt && onViewDetails) {
          onViewDetails(selectedPrompt);
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
  // Reset scroll when selection changes
  useEffect(() => {
    scrollViewRef.current?.scrollTo(0);
  }, [selectedIndex]);
  // Reset selected index when prompts array changes (different server)
  useEffect(() => {
    setSelectedIndex(0);
  }, [prompts]);
  const selectedPrompt = prompts[selectedIndex] || null;
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
            children: _jsxs(Text, {
              bold: true,
              backgroundColor: focusedPane === "list" ? "yellow" : undefined,
              children: ["Prompts (", prompts.length, ")"],
            }),
          }),
          error
            ? _jsx(Box, {
                paddingY: 1,
                children: _jsx(Text, { color: "red", children: error }),
              })
            : prompts.length === 0
              ? _jsx(Box, {
                  paddingY: 1,
                  children: _jsx(Text, {
                    dimColor: true,
                    children: "No prompts available",
                  }),
                })
              : _jsx(Box, {
                  flexDirection: "column",
                  flexGrow: 1,
                  children: prompts.map((prompt, index) => {
                    const isSelected = index === selectedIndex;
                    return _jsx(
                      Box,
                      {
                        paddingY: 0,
                        children: _jsxs(Text, {
                          children: [
                            isSelected ? "▶ " : "  ",
                            prompt.name || `Prompt ${index + 1}`,
                          ],
                        }),
                      },
                      prompt.name || index,
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
        children: selectedPrompt
          ? _jsxs(_Fragment, {
              children: [
                _jsx(Box, {
                  flexShrink: 0,
                  paddingTop: 1,
                  children: _jsx(Text, {
                    bold: true,
                    backgroundColor:
                      focusedPane === "details" ? "yellow" : undefined,
                    ...(focusedPane === "details" ? {} : { color: "cyan" }),
                    children: selectedPrompt.name,
                  }),
                }),
                _jsxs(ScrollView, {
                  ref: scrollViewRef,
                  height: height - 5,
                  children: [
                    selectedPrompt.description &&
                      _jsx(_Fragment, {
                        children: selectedPrompt.description
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
                    selectedPrompt.arguments &&
                      selectedPrompt.arguments.length > 0 &&
                      _jsxs(_Fragment, {
                        children: [
                          _jsx(Box, {
                            marginTop: 1,
                            flexShrink: 0,
                            children: _jsx(Text, {
                              bold: true,
                              children: "Arguments:",
                            }),
                          }),
                          selectedPrompt.arguments.map((arg, idx) =>
                            _jsx(
                              Box,
                              {
                                marginTop: 1,
                                paddingLeft: 2,
                                flexShrink: 0,
                                children: _jsxs(Text, {
                                  dimColor: true,
                                  children: [
                                    "- ",
                                    arg.name,
                                    ": ",
                                    arg.description || arg.type || "string",
                                  ],
                                }),
                              },
                              `arg-${idx}`,
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
                children: "Select a prompt to view details",
              }),
            }),
      }),
    ],
  });
}
