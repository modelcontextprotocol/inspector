import React, { useEffect, useRef } from "react";
import { Box, Text, useInput, type Key } from "ink";
import { ScrollView, type ScrollViewRef } from "ink-scroll-view";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { StderrLogEntry } from "@modelcontextprotocol/inspector-shared/mcp/index.js";

interface NotificationsTabProps {
  client: Client | null;
  stderrLogs: StderrLogEntry[];
  width: number;
  height: number;
  onCountChange?: (count: number) => void;
  focused?: boolean;
}

export function NotificationsTab({
  client,
  stderrLogs,
  width,
  height,
  onCountChange,
  focused = false,
}: NotificationsTabProps) {
  const scrollViewRef = useRef<ScrollViewRef>(null);
  const onCountChangeRef = useRef(onCountChange);

  // Update ref when callback changes
  useEffect(() => {
    onCountChangeRef.current = onCountChange;
  }, [onCountChange]);

  useEffect(() => {
    onCountChangeRef.current?.(stderrLogs.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stderrLogs.length]);

  // Handle keyboard input for scrolling
  useInput(
    (input: string, key: Key) => {
      if (focused) {
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
    { isActive: focused },
  );

  return (
    <Box width={width} height={height} flexDirection="column" paddingX={1}>
      <Box paddingY={1} flexShrink={0}>
        <Text bold backgroundColor={focused ? "yellow" : undefined}>
          Logging ({stderrLogs.length})
        </Text>
      </Box>
      {stderrLogs.length === 0 ? (
        <Box paddingY={1}>
          <Text dimColor>No stderr output yet</Text>
        </Box>
      ) : (
        <ScrollView ref={scrollViewRef} height={height - 3}>
          {stderrLogs.map((log, index) => (
            <Box
              key={`log-${log.timestamp.getTime()}-${index}`}
              paddingY={0}
              flexDirection="row"
              flexShrink={0}
            >
              <Text dimColor>[{log.timestamp.toLocaleTimeString()}] </Text>
              <Text color="red">{log.message}</Text>
            </Box>
          ))}
        </ScrollView>
      )}
    </Box>
  );
}
