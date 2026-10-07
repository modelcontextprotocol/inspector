import React, { useRef } from "react";
import { Box, Text, useInput, type Key } from "ink";
import { ScrollView, type ScrollViewRef } from "ink-scroll-view";
import type {
  MCPServerConfig,
  ServerState,
} from "@inspector/core/mcp/index.js";
import type { InspectorServerSettings } from "@inspector/core/mcp/types.js";
import type { Root } from "@modelcontextprotocol/client";

interface InfoTabProps {
  serverName: string | null;
  serverConfig: MCPServerConfig | null;
  // HTTP headers live on the per-server settings (pair-array form), not on the
  // transport `serverConfig` — `mcpConfigToServerEntries` lifts the on-disk
  // `headers` map into `InspectorServerSettings.headers`. Read them here so the
  // SSE / streamable-http header display reflects the real source.
  serverSettings?: InspectorServerSettings | null;
  serverState: ServerState | null;
  width: number;
  height: number;
  focused?: boolean;
  /** The roots the client currently advertises to this server (#2432). */
  roots?: Root[];
  /** Open the roots editor — bound to `e` while this pane is focused. */
  onEditRoots?: () => void;
}

export function InfoTab({
  serverName,
  serverConfig,
  serverSettings = null,
  serverState,
  width,
  height,
  focused = false,
  roots = [],
  onEditRoots,
}: InfoTabProps) {
  const headerPairs = serverSettings?.headers ?? [];
  // Shared header display for the sse / streamable-http branches (identical for
  // both transports — the header source is `serverSettings`, not the transport).
  const headersBlock =
    headerPairs.length > 0 ? (
      <Box marginTop={1}>
        <Text dimColor>
          Headers:{" "}
          {headerPairs.map(({ key, value }) => `${key}=${value}`).join(", ")}
        </Text>
      </Box>
    ) : null;
  const scrollViewRef = useRef<ScrollViewRef>(null);

  // Handle keyboard input for scrolling
  useInput(
    (input: string, key: Key) => {
      if (focused) {
        if (input === "e" && onEditRoots) {
          onEditRoots();
        } else if (key.upArrow) {
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
          Info
        </Text>
      </Box>

      {serverName ? (
        <>
          {/* Scrollable content area - takes remaining space */}
          <Box height={height - 4} overflow="hidden" paddingTop={1}>
            <ScrollView ref={scrollViewRef} height={height - 4}>
              {/* Server Configuration */}
              <Box flexShrink={0} marginTop={1}>
                <Text bold>Server Configuration</Text>
              </Box>
              {serverConfig ? (
                <Box
                  flexShrink={0}
                  marginTop={1}
                  paddingLeft={2}
                  flexDirection="column"
                >
                  {serverConfig.type === undefined ||
                  serverConfig.type === "stdio" ? (
                    <>
                      <Text dimColor>Type: stdio</Text>
                      <Text dimColor>Command: {serverConfig.command}</Text>
                      {serverConfig.args && serverConfig.args.length > 0 && (
                        <Box marginTop={1} flexDirection="column">
                          <Text dimColor>Args:</Text>
                          {serverConfig.args.map((arg: string, idx: number) => (
                            <Box
                              key={`arg-${idx}`}
                              paddingLeft={2}
                              marginTop={idx === 0 ? 0 : 0}
                            >
                              <Text dimColor>{arg}</Text>
                            </Box>
                          ))}
                        </Box>
                      )}
                      {serverConfig.env &&
                        Object.keys(serverConfig.env).length > 0 && (
                          <Box marginTop={1}>
                            <Text dimColor>
                              Env:{" "}
                              {Object.entries(serverConfig.env)
                                .map(([k, v]) => `${k}=${v}`)
                                .join(", ")}
                            </Text>
                          </Box>
                        )}
                      {serverConfig.cwd && (
                        <Box marginTop={1}>
                          <Text dimColor>CWD: {serverConfig.cwd}</Text>
                        </Box>
                      )}
                    </>
                  ) : serverConfig.type === "sse" ? (
                    <>
                      <Text dimColor>Type: sse</Text>
                      <Text dimColor>URL: {serverConfig.url}</Text>
                      {headersBlock}
                    </>
                  ) : serverConfig.type === "streamable-http" ? (
                    <>
                      <Text dimColor>Type: streamable-http</Text>
                      <Text dimColor>URL: {serverConfig.url}</Text>
                      {headersBlock}
                    </>
                  ) : null}
                </Box>
              ) : (
                <Box marginTop={1} paddingLeft={2}>
                  <Text dimColor>No configuration available</Text>
                </Box>
              )}

              {/* Server Info */}
              {serverState &&
                serverState.status === "connected" &&
                serverState.serverInfo && (
                  <>
                    <Box flexShrink={0} marginTop={2}>
                      <Text bold>Server Information</Text>
                    </Box>
                    <Box
                      flexShrink={0}
                      marginTop={1}
                      paddingLeft={2}
                      flexDirection="column"
                    >
                      {serverState.serverInfo.name && (
                        <Text dimColor>
                          Name: {serverState.serverInfo.name}
                        </Text>
                      )}
                      {serverState.serverInfo.version && (
                        <Box marginTop={1}>
                          <Text dimColor>
                            Version: {serverState.serverInfo.version}
                          </Text>
                        </Box>
                      )}
                      {serverState.instructions && (
                        <Box marginTop={1} flexDirection="column">
                          <Text dimColor>Instructions:</Text>
                          <Box paddingLeft={2} marginTop={1}>
                            <Text dimColor>{serverState.instructions}</Text>
                          </Box>
                        </Box>
                      )}
                    </Box>
                  </>
                )}

              {serverState && serverState.status === "error" && (
                <Box flexShrink={0} marginTop={2}>
                  <Text bold color="red">
                    Error
                  </Text>
                  {serverState.error && (
                    <Box marginTop={1} paddingLeft={2}>
                      <Text color="red">{serverState.error}</Text>
                    </Box>
                  )}
                </Box>
              )}

              {serverState && serverState.status === "disconnected" && (
                <Box flexShrink={0} marginTop={2}>
                  <Text dimColor>Server not connected</Text>
                </Box>
              )}
              {/* Roots advertised to the server (#2432) */}
              <Box flexShrink={0} marginTop={2}>
                <Text bold>Roots ({roots.length})</Text>
              </Box>
              <Box
                flexShrink={0}
                marginTop={1}
                paddingLeft={2}
                flexDirection="column"
              >
                {roots.length === 0 ? (
                  <Text dimColor>None</Text>
                ) : (
                  roots.map((root, idx) => (
                    <Text key={`root-${idx}`} dimColor>
                      {root.uri}
                      {root.name ? ` (${root.name})` : ""}
                    </Text>
                  ))
                )}
              </Box>
            </ScrollView>
          </Box>

          {/* Fixed keyboard help footer at bottom - only show when focused */}
          {focused && (
            <Box
              flexShrink={0}
              height={1}
              justifyContent="center"
              backgroundColor="gray"
            >
              <Text bold color="white">
                ↑/↓ to scroll, + to zoom
                {onEditRoots ? ", e to edit roots" : ""}
              </Text>
            </Box>
          )}
        </>
      ) : null}
    </Box>
  );
}
