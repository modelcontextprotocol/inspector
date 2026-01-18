import {
  jsxs as _jsxs,
  jsx as _jsx,
  Fragment as _Fragment,
} from "react/jsx-runtime";
import { useState, useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";
import { ScrollView } from "ink-scroll-view";
export function ResourcesTab({
  resources,
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
        } else if (key.downArrow && selectedIndex < resources.length - 1) {
          setSelectedIndex(selectedIndex + 1);
        }
        return;
      }
      if (focusedPane === "details") {
        // Handle '+' key to view in full screen modal
        if (input === "+" && selectedResource && onViewDetails) {
          onViewDetails(selectedResource);
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
  // Reset selected index when resources array changes (different server)
  useEffect(() => {
    setSelectedIndex(0);
  }, [resources]);
  const selectedResource = resources[selectedIndex] || null;
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
              children: ["Resources (", resources.length, ")"],
            }),
          }),
          error
            ? _jsx(Box, {
                paddingY: 1,
                children: _jsx(Text, { color: "red", children: error }),
              })
            : resources.length === 0
              ? _jsx(Box, {
                  paddingY: 1,
                  children: _jsx(Text, {
                    dimColor: true,
                    children: "No resources available",
                  }),
                })
              : _jsx(Box, {
                  flexDirection: "column",
                  flexGrow: 1,
                  children: resources.map((resource, index) => {
                    const isSelected = index === selectedIndex;
                    return _jsx(
                      Box,
                      {
                        paddingY: 0,
                        children: _jsxs(Text, {
                          children: [
                            isSelected ? "▶ " : "  ",
                            resource.name ||
                              resource.uri ||
                              `Resource ${index + 1}`,
                          ],
                        }),
                      },
                      resource.uri || index,
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
        children: selectedResource
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
                    children: selectedResource.name || selectedResource.uri,
                  }),
                }),
                _jsxs(ScrollView, {
                  ref: scrollViewRef,
                  height: height - 5,
                  children: [
                    selectedResource.description &&
                      _jsx(_Fragment, {
                        children: selectedResource.description
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
                    selectedResource.uri &&
                      _jsx(Box, {
                        marginTop: 1,
                        flexShrink: 0,
                        children: _jsxs(Text, {
                          dimColor: true,
                          children: ["URI: ", selectedResource.uri],
                        }),
                      }),
                    selectedResource.mimeType &&
                      _jsx(Box, {
                        marginTop: 1,
                        flexShrink: 0,
                        children: _jsxs(Text, {
                          dimColor: true,
                          children: ["MIME Type: ", selectedResource.mimeType],
                        }),
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
                children: "Select a resource to view details",
              }),
            }),
      }),
    ],
  });
}
