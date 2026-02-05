import React, { useState, useEffect, useRef } from "react";
import { Box, Text, useInput, type Key } from "ink";
import { ScrollView, type ScrollViewRef } from "ink-scroll-view";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { useSelectableList } from "../hooks/useSelectableList.js";

interface ToolsTabProps {
  tools: any[];
  client: Client | null;
  width: number;
  height: number;
  onCountChange?: (count: number) => void;
  focusedPane?: "list" | "details" | null;
  onTestTool?: (tool: any) => void;
  onViewDetails?: (tool: any) => void;
  modalOpen?: boolean;
}

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
}: ToolsTabProps) {
  const visibleCount = Math.max(1, height - 7);
  const { selectedIndex, firstVisible, setSelection } = useSelectableList(
    tools.length,
    visibleCount,
    { resetWhen: [tools] },
  );
  const [error, setError] = useState<string | null>(null);
  const scrollViewRef = useRef<ScrollViewRef>(null);
  const listWidth = Math.floor(width * 0.4);
  const detailWidth = width - listWidth;

  // Handle arrow key navigation when focused
  useInput(
    (input: string, key: Key) => {
      // Handle Enter key to test tool (works from both list and details)
      if (key.return && selectedTool && client && onTestTool) {
        onTestTool(selectedTool);
        return;
      }

      if (focusedPane === "list") {
        if (key.upArrow && selectedIndex > 0) {
          setSelection(selectedIndex - 1);
        } else if (key.downArrow && selectedIndex < tools.length - 1) {
          setSelection(selectedIndex + 1);
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
  const calculateToolContentLines = (tool: any): number => {
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

  const selectedTool = tools[selectedIndex] || null;

  return (
    <Box flexDirection="row" width={width} height={height}>
      {/* Tools List */}
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
        <Box paddingY={1}>
          <Text
            bold
            backgroundColor={focusedPane === "list" ? "yellow" : undefined}
          >
            Tools ({tools.length})
          </Text>
        </Box>
        {error ? (
          <Box paddingY={1}>
            <Text color="red">{error}</Text>
          </Box>
        ) : tools.length === 0 ? (
          <Box paddingY={1}>
            <Text dimColor>No tools available</Text>
          </Box>
        ) : (
          <Box
            flexDirection="column"
            height={visibleCount}
            overflow="hidden"
            flexShrink={0}
          >
            {tools
              .slice(firstVisible, firstVisible + visibleCount)
              .map((tool, i) => {
                const index = firstVisible + i;
                const isSelected = index === selectedIndex;
                return (
                  <Box key={tool.name || index} paddingY={0} flexShrink={0}>
                    <Text>
                      {isSelected ? "▶ " : "  "}
                      {tool.name || `Tool ${index + 1}`}
                    </Text>
                  </Box>
                );
              })}
          </Box>
        )}
      </Box>

      {/* Tool Details */}
      <Box
        width={detailWidth}
        height={height}
        paddingX={1}
        flexDirection="column"
        overflow="hidden"
      >
        {selectedTool ? (
          <>
            {/* Fixed header */}
            <Box
              flexShrink={0}
              flexDirection="row"
              justifyContent="space-between"
              paddingTop={1}
            >
              <Text
                bold
                backgroundColor={
                  focusedPane === "details" ? "yellow" : undefined
                }
                {...(focusedPane === "details" ? {} : { color: "cyan" })}
              >
                {selectedTool.name}
              </Text>
              {client && (
                <Text>
                  <Text color="cyan" bold>
                    [Enter to Test]
                  </Text>
                </Text>
              )}
            </Box>

            {/* Scrollable content area - direct ScrollView with height prop like NotificationsTab */}
            <ScrollView ref={scrollViewRef} height={height - 5}>
              {/* Description */}
              {selectedTool.description && (
                <>
                  {selectedTool.description
                    .split("\n")
                    .map((line: string, idx: number) => (
                      <Box
                        key={`desc-${idx}`}
                        marginTop={idx === 0 ? 1 : 0}
                        flexShrink={0}
                      >
                        <Text dimColor>{line}</Text>
                      </Box>
                    ))}
                </>
              )}

              {/* Input Schema */}
              {selectedTool.inputSchema && (
                <>
                  <Box marginTop={1} flexShrink={0}>
                    <Text bold>Input Schema:</Text>
                  </Box>
                  {JSON.stringify(selectedTool.inputSchema, null, 2)
                    .split("\n")
                    .map((line: string, idx: number) => (
                      <Box
                        key={`schema-${idx}`}
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
            <Text dimColor>Select a tool to view details</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
