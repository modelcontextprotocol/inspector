import {
  jsx as _jsx,
  jsxs as _jsxs,
  Fragment as _Fragment,
} from "react/jsx-runtime";
import { useRef } from "react";
import { Box, Text, useInput } from "ink";
import { ScrollView } from "ink-scroll-view";
export function InfoTab({
  serverName,
  serverConfig,
  serverState,
  width,
  height,
  focused = false,
}) {
  const scrollViewRef = useRef(null);
  // Handle keyboard input for scrolling
  useInput(
    (input, key) => {
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
  return _jsxs(Box, {
    width: width,
    height: height,
    flexDirection: "column",
    paddingX: 1,
    children: [
      _jsx(Box, {
        paddingY: 1,
        flexShrink: 0,
        children: _jsx(Text, {
          bold: true,
          backgroundColor: focused ? "yellow" : undefined,
          children: "Info",
        }),
      }),
      serverName
        ? _jsxs(_Fragment, {
            children: [
              _jsx(Box, {
                height: height - 4,
                overflow: "hidden",
                paddingTop: 1,
                children: _jsxs(ScrollView, {
                  ref: scrollViewRef,
                  height: height - 4,
                  children: [
                    _jsx(Box, {
                      flexShrink: 0,
                      marginTop: 1,
                      children: _jsx(Text, {
                        bold: true,
                        children: "Server Configuration",
                      }),
                    }),
                    serverConfig
                      ? _jsx(Box, {
                          flexShrink: 0,
                          marginTop: 1,
                          paddingLeft: 2,
                          flexDirection: "column",
                          children:
                            serverConfig.type === undefined ||
                            serverConfig.type === "stdio"
                              ? _jsxs(_Fragment, {
                                  children: [
                                    _jsx(Text, {
                                      dimColor: true,
                                      children: "Type: stdio",
                                    }),
                                    _jsxs(Text, {
                                      dimColor: true,
                                      children: [
                                        "Command: ",
                                        serverConfig.command,
                                      ],
                                    }),
                                    serverConfig.args &&
                                      serverConfig.args.length > 0 &&
                                      _jsxs(Box, {
                                        marginTop: 1,
                                        flexDirection: "column",
                                        children: [
                                          _jsx(Text, {
                                            dimColor: true,
                                            children: "Args:",
                                          }),
                                          serverConfig.args.map((arg, idx) =>
                                            _jsx(
                                              Box,
                                              {
                                                paddingLeft: 2,
                                                marginTop: idx === 0 ? 0 : 0,
                                                children: _jsx(Text, {
                                                  dimColor: true,
                                                  children: arg,
                                                }),
                                              },
                                              `arg-${idx}`,
                                            ),
                                          ),
                                        ],
                                      }),
                                    serverConfig.env &&
                                      Object.keys(serverConfig.env).length >
                                        0 &&
                                      _jsx(Box, {
                                        marginTop: 1,
                                        children: _jsxs(Text, {
                                          dimColor: true,
                                          children: [
                                            "Env: ",
                                            Object.entries(serverConfig.env)
                                              .map(([k, v]) => `${k}=${v}`)
                                              .join(", "),
                                          ],
                                        }),
                                      }),
                                    serverConfig.cwd &&
                                      _jsx(Box, {
                                        marginTop: 1,
                                        children: _jsxs(Text, {
                                          dimColor: true,
                                          children: ["CWD: ", serverConfig.cwd],
                                        }),
                                      }),
                                  ],
                                })
                              : serverConfig.type === "sse"
                                ? _jsxs(_Fragment, {
                                    children: [
                                      _jsx(Text, {
                                        dimColor: true,
                                        children: "Type: sse",
                                      }),
                                      _jsxs(Text, {
                                        dimColor: true,
                                        children: ["URL: ", serverConfig.url],
                                      }),
                                      serverConfig.headers &&
                                        Object.keys(serverConfig.headers)
                                          .length > 0 &&
                                        _jsx(Box, {
                                          marginTop: 1,
                                          children: _jsxs(Text, {
                                            dimColor: true,
                                            children: [
                                              "Headers: ",
                                              Object.entries(
                                                serverConfig.headers,
                                              )
                                                .map(([k, v]) => `${k}=${v}`)
                                                .join(", "),
                                            ],
                                          }),
                                        }),
                                    ],
                                  })
                                : _jsxs(_Fragment, {
                                    children: [
                                      _jsx(Text, {
                                        dimColor: true,
                                        children: "Type: streamableHttp",
                                      }),
                                      _jsxs(Text, {
                                        dimColor: true,
                                        children: ["URL: ", serverConfig.url],
                                      }),
                                      serverConfig.headers &&
                                        Object.keys(serverConfig.headers)
                                          .length > 0 &&
                                        _jsx(Box, {
                                          marginTop: 1,
                                          children: _jsxs(Text, {
                                            dimColor: true,
                                            children: [
                                              "Headers: ",
                                              Object.entries(
                                                serverConfig.headers,
                                              )
                                                .map(([k, v]) => `${k}=${v}`)
                                                .join(", "),
                                            ],
                                          }),
                                        }),
                                    ],
                                  }),
                        })
                      : _jsx(Box, {
                          marginTop: 1,
                          paddingLeft: 2,
                          children: _jsx(Text, {
                            dimColor: true,
                            children: "No configuration available",
                          }),
                        }),
                    serverState &&
                      serverState.status === "connected" &&
                      serverState.serverInfo &&
                      _jsxs(_Fragment, {
                        children: [
                          _jsx(Box, {
                            flexShrink: 0,
                            marginTop: 2,
                            children: _jsx(Text, {
                              bold: true,
                              children: "Server Information",
                            }),
                          }),
                          _jsxs(Box, {
                            flexShrink: 0,
                            marginTop: 1,
                            paddingLeft: 2,
                            flexDirection: "column",
                            children: [
                              serverState.serverInfo.name &&
                                _jsxs(Text, {
                                  dimColor: true,
                                  children: [
                                    "Name: ",
                                    serverState.serverInfo.name,
                                  ],
                                }),
                              serverState.serverInfo.version &&
                                _jsx(Box, {
                                  marginTop: 1,
                                  children: _jsxs(Text, {
                                    dimColor: true,
                                    children: [
                                      "Version: ",
                                      serverState.serverInfo.version,
                                    ],
                                  }),
                                }),
                              serverState.instructions &&
                                _jsxs(Box, {
                                  marginTop: 1,
                                  flexDirection: "column",
                                  children: [
                                    _jsx(Text, {
                                      dimColor: true,
                                      children: "Instructions:",
                                    }),
                                    _jsx(Box, {
                                      paddingLeft: 2,
                                      marginTop: 1,
                                      children: _jsx(Text, {
                                        dimColor: true,
                                        children: serverState.instructions,
                                      }),
                                    }),
                                  ],
                                }),
                            ],
                          }),
                        ],
                      }),
                    serverState &&
                      serverState.status === "error" &&
                      _jsxs(Box, {
                        flexShrink: 0,
                        marginTop: 2,
                        children: [
                          _jsx(Text, {
                            bold: true,
                            color: "red",
                            children: "Error",
                          }),
                          serverState.error &&
                            _jsx(Box, {
                              marginTop: 1,
                              paddingLeft: 2,
                              children: _jsx(Text, {
                                color: "red",
                                children: serverState.error,
                              }),
                            }),
                        ],
                      }),
                    serverState &&
                      serverState.status === "disconnected" &&
                      _jsx(Box, {
                        flexShrink: 0,
                        marginTop: 2,
                        children: _jsx(Text, {
                          dimColor: true,
                          children: "Server not connected",
                        }),
                      }),
                  ],
                }),
              }),
              focused &&
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
        : null,
    ],
  });
}
