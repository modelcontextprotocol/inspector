import React, { useState, useEffect, useRef } from "react";
import { Box, Text, useInput, type Key } from "ink";
import { ScrollView, type ScrollViewRef } from "ink-scroll-view";
import type { InspectorClient } from "@modelcontextprotocol/inspector-shared/mcp/index.js";

interface PromptsTabProps {
  prompts: any[];
  client: any; // SDK Client (from inspectorClient.getClient())
  inspectorClient: InspectorClient | null; // InspectorClient for getPrompt
  width: number;
  height: number;
  onCountChange?: (count: number) => void;
  focusedPane?: "list" | "details" | null;
  onViewDetails?: (prompt: any) => void;
  onFetchPrompt?: (prompt: any) => void;
  modalOpen?: boolean;
}

export function PromptsTab({
  prompts,
  client,
  inspectorClient,
  width,
  height,
  onCountChange,
  focusedPane = null,
  onViewDetails,
  onFetchPrompt,
  modalOpen = false,
}: PromptsTabProps) {
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const scrollViewRef = useRef<ScrollViewRef>(null);
  const listScrollViewRef = useRef<ScrollViewRef>(null);

  // Handle arrow key navigation when focused
  useInput(
    (input: string, key: Key) => {
      // Handle Enter key to fetch prompt (works from both list and details)
      if (key.return && selectedPrompt && inspectorClient && onFetchPrompt) {
        // If prompt has arguments, open modal to collect them
        // Otherwise, fetch directly
        if (selectedPrompt.arguments && selectedPrompt.arguments.length > 0) {
          onFetchPrompt(selectedPrompt);
        } else {
          // No arguments, fetch directly
          (async () => {
            try {
              const invocation = await inspectorClient.getPrompt(
                selectedPrompt.name,
              );
              // Show result in details modal
              if (onViewDetails) {
                onViewDetails({
                  ...selectedPrompt,
                  result: invocation.result,
                });
              }
            } catch (error) {
              setError(
                error instanceof Error ? error.message : "Failed to get prompt",
              );
            }
          })();
        }
        return;
      }

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

  // Auto-scroll list to show selected item
  useEffect(() => {
    if (listScrollViewRef.current && selectedIndex >= 0 && prompts.length > 0) {
      listScrollViewRef.current.scrollTo(selectedIndex);
    }
  }, [selectedIndex, prompts.length]);

  // Reset selected index when prompts array changes (different server)
  useEffect(() => {
    setSelectedIndex(0);
  }, [prompts]);

  const selectedPrompt = prompts[selectedIndex] || null;

  const listWidth = Math.floor(width * 0.4);
  const detailWidth = width - listWidth;

  return (
    <Box flexDirection="row" width={width} height={height}>
      {/* Prompts List */}
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
            Prompts ({prompts.length})
          </Text>
        </Box>
        {error ? (
          <Box paddingY={1}>
            <Text color="red">{error}</Text>
          </Box>
        ) : prompts.length === 0 ? (
          <Box paddingY={1}>
            <Text dimColor>No prompts available</Text>
          </Box>
        ) : (
          <ScrollView ref={listScrollViewRef} height={height - 2}>
            {prompts.map((prompt, index) => {
              const isSelected = index === selectedIndex;
              return (
                <Box key={prompt.name || index} paddingY={0}>
                  <Text>
                    {isSelected ? "▶ " : "  "}
                    {prompt.name || `Prompt ${index + 1}`}
                  </Text>
                </Box>
              );
            })}
          </ScrollView>
        )}
      </Box>

      {/* Prompt Details */}
      <Box
        width={detailWidth}
        height={height}
        paddingX={1}
        flexDirection="column"
        overflow="hidden"
      >
        {selectedPrompt ? (
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
                {selectedPrompt.name}
              </Text>
            </Box>

            {/* Scrollable content area - direct ScrollView with height prop like NotificationsTab */}
            <ScrollView ref={scrollViewRef} height={height - 5}>
              {/* Description */}
              {selectedPrompt.description && (
                <>
                  {selectedPrompt.description
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

              {/* Arguments */}
              {selectedPrompt.arguments &&
                selectedPrompt.arguments.length > 0 && (
                  <>
                    <Box marginTop={1} flexShrink={0}>
                      <Text bold>Arguments:</Text>
                    </Box>
                    {selectedPrompt.arguments.map((arg: any, idx: number) => (
                      <Box
                        key={`arg-${idx}`}
                        marginTop={1}
                        paddingLeft={2}
                        flexShrink={0}
                      >
                        <Text dimColor>
                          - {arg.name}:{" "}
                          {arg.description || arg.type || "string"}
                        </Text>
                      </Box>
                    ))}
                  </>
                )}

              {/* Enter to Get Prompt message */}
              <Box marginTop={1} flexShrink={0}>
                <Text dimColor>[Enter to Get Prompt]</Text>
              </Box>
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
            <Text dimColor>Select a prompt to view details</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
