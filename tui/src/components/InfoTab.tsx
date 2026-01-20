import React, { useRef } from "react";
import { Box, Text, useInput, type Key } from "ink";
import { ScrollView, type ScrollViewRef } from "ink-scroll-view";
import type {
  MCPServerConfig,
  ServerState,
} from "@modelcontextprotocol/inspector-shared/mcp/index.js";

interface InfoTabProps {
  serverName: string | null;
  serverConfig: MCPServerConfig | null;
  serverState: ServerState | null;
  width: number;
  height: number;
  focused?: boolean;
}

export function InfoTab({
  serverName,
  serverConfig,
  serverState,
  width,
  height,
  focused = false,
}: InfoTabProps) {
  const scrollViewRef = useRef<ScrollViewRef>(null);

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
                      <Text dimColor>
                        Command: {(serverConfig as any).command}
                      </Text>
                      {(serverConfig as any).args &&
                        (serverConfig as any).args.length > 0 && (
                          <Box marginTop={1} flexDirection="column">
                            <Text dimColor>Args:</Text>
                            {(serverConfig as any).args.map(
                              (arg: string, idx: number) => (
                                <Box
                                  key={`arg-${idx}`}
                                  paddingLeft={2}
                                  marginTop={idx === 0 ? 0 : 0}
                                >
                                  <Text dimColor>{arg}</Text>
                                </Box>
                              ),
                            )}
                          </Box>
                        )}
                      {(serverConfig as any).env &&
                        Object.keys((serverConfig as any).env).length > 0 && (
                          <Box marginTop={1}>
                            <Text dimColor>
                              Env:{" "}
                              {Object.entries((serverConfig as any).env)
                                .map(([k, v]) => `${k}=${v}`)
                                .join(", ")}
                            </Text>
                          </Box>
                        )}
                      {(serverConfig as any).cwd && (
                        <Box marginTop={1}>
                          <Text dimColor>CWD: {(serverConfig as any).cwd}</Text>
                        </Box>
                      )}
                    </>
                  ) : serverConfig.type === "sse" ? (
                    <>
                      <Text dimColor>Type: sse</Text>
                      <Text dimColor>URL: {(serverConfig as any).url}</Text>
                      {(serverConfig as any).headers &&
                        Object.keys((serverConfig as any).headers).length >
                          0 && (
                          <Box marginTop={1}>
                            <Text dimColor>
                              Headers:{" "}
                              {Object.entries((serverConfig as any).headers)
                                .map(([k, v]) => `${k}=${v}`)
                                .join(", ")}
                            </Text>
                          </Box>
                        )}
                    </>
                  ) : (
                    <>
                      <Text dimColor>Type: streamable-http</Text>
                      <Text dimColor>URL: {(serverConfig as any).url}</Text>
                      {(serverConfig as any).headers &&
                        Object.keys((serverConfig as any).headers).length >
                          0 && (
                          <Box marginTop={1}>
                            <Text dimColor>
                              Headers:{" "}
                              {Object.entries((serverConfig as any).headers)
                                .map(([k, v]) => `${k}=${v}`)
                                .join(", ")}
                            </Text>
                          </Box>
                        )}
                    </>
                  )}
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
              </Text>
            </Box>
          )}
        </>
      ) : null}
    </Box>
  );
}
