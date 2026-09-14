import React, { useState, useEffect, useMemo, useRef } from "react";
import { Box, Text, useInput, type Key } from "ink";
import { ScrollView, type ScrollViewRef } from "ink-scroll-view";
import type { Tool } from "@modelcontextprotocol/client";
import {
  describeSchemaPath,
  lintToolSchemas,
  type SchemaFinding,
} from "@inspector/core/json/schemaLint.js";
import { useSelectableList } from "../hooks/useSelectableList.js";

/**
 * How each severity renders in the terminal (#1005). One table, read by both
 * the list row's flag and the detail block's heading, so the two can never
 * disagree about what a severity looks like.
 */
const SEVERITY_MARKER = {
  error: { glyph: "!", color: "red" },
  warning: { glyph: "?", color: "yellow" },
} as const satisfies Record<
  SchemaFinding["severity"],
  { glyph: string; color: string }
>;

/**
 * The one-glyph flag a tool row carries when its schemas have portability
 * findings: `!` in red when something is refused outright by a real client,
 * `?` in yellow when it is merely handled unevenly. `undefined` — no glyph at
 * all — for a clean tool, which is the overwhelming majority, so the list
 * stays quiet unless there is something to say.
 */
export function schemaMarker(
  findings: readonly SchemaFinding[] | undefined,
): { glyph: string; color: string } | undefined {
  if (!findings || findings.length === 0) return undefined;
  return findings.some((f) => f.severity === "error")
    ? SEVERITY_MARKER.error
    : SEVERITY_MARKER.warning;
}

interface ToolsTabProps {
  tools: Tool[];
  isConnected: boolean;
  width: number;
  height: number;
  onCountChange?: (count: number) => void;
  focusedPane?: "list" | "details" | null;
  onTestTool?: (tool: Tool) => void;
  onViewDetails?: (tool: Tool) => void;
  modalOpen?: boolean;
}

export function ToolsTab({
  tools,
  isConnected,
  width,
  height,
  focusedPane = null,
  onTestTool,
  onViewDetails,
  modalOpen = false,
}: ToolsTabProps) {
  const visibleCount = Math.max(1, height - 7);
  const { selectedIndex, firstVisible, setSelection } = useSelectableList(
    tools.length,
    visibleCount,
    { resetWhen: tools },
  );
  const [error] = useState<string | null>(null);
  // Tool-schema portability findings, one entry per tool, same order (#1005).
  // Pure walk over data already in memory, so it is recomputed only when the
  // list itself changes rather than on every keypress.
  const findingsByTool = useMemo(
    () => tools.map((tool) => lintToolSchemas(tool)),
    [tools],
  );
  const scrollViewRef = useRef<ScrollViewRef>(null);
  const listWidth = Math.floor(width * 0.4);
  const detailWidth = width - listWidth;

  // Handle arrow key navigation when focused
  useInput(
    (input: string, key: Key) => {
      // Handle Enter key to test tool (works from both list and details)
      if (key.return && selectedTool && isConnected && onTestTool) {
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

  // Reset scroll when selection changes
  useEffect(() => {
    scrollViewRef.current?.scrollTo(0);
  }, [selectedIndex]);

  const selectedTool = tools[selectedIndex] || null;
  const selectedFindings = findingsByTool[selectedIndex] ?? [];

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
                const marker = schemaMarker(findingsByTool[index]);
                return (
                  <Box key={tool.name || index} paddingY={0} flexShrink={0}>
                    <Text>
                      {isSelected ? "▶ " : "  "}
                      {tool.name || `Tool ${index + 1}`}
                      {marker && (
                        <Text color={marker.color}> {marker.glyph}</Text>
                      )}
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
              {isConnected && (
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

              {/* Schema portability findings (#1005) */}
              {selectedFindings.length > 0 && (
                <>
                  <Box marginTop={1} flexShrink={0}>
                    <Text bold color="yellow">
                      Schema Portability ({selectedFindings.length}):
                    </Text>
                  </Box>
                  {selectedFindings.map((finding, idx) => {
                    const marker = SEVERITY_MARKER[finding.severity];
                    return (
                      <Box
                        key={`finding-${finding.schema}-${finding.path}-${finding.rule}-${idx}`}
                        flexDirection="column"
                        paddingLeft={2}
                        marginTop={1}
                        flexShrink={0}
                      >
                        <Text color={marker.color}>
                          {marker.glyph}{" "}
                          {describeSchemaPath(finding.schema, finding.path)}
                        </Text>
                        <Text dimColor>{finding.issue}</Text>
                        <Text dimColor>Fix: {finding.suggestion}</Text>
                      </Box>
                    );
                  })}
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
