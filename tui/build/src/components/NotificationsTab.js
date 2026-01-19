import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useRef } from "react";
import { Box, Text, useInput } from "ink";
import { ScrollView } from "ink-scroll-view";
export function NotificationsTab({
  client,
  stderrLogs,
  width,
  height,
  onCountChange,
  focused = false,
}) {
  const scrollViewRef = useRef(null);
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
        children: _jsxs(Text, {
          bold: true,
          backgroundColor: focused ? "yellow" : undefined,
          children: ["Logging (", stderrLogs.length, ")"],
        }),
      }),
      stderrLogs.length === 0
        ? _jsx(Box, {
            paddingY: 1,
            children: _jsx(Text, {
              dimColor: true,
              children: "No stderr output yet",
            }),
          })
        : _jsx(ScrollView, {
            ref: scrollViewRef,
            height: height - 3,
            children: stderrLogs.map((log, index) =>
              _jsxs(
                Box,
                {
                  paddingY: 0,
                  flexDirection: "row",
                  flexShrink: 0,
                  children: [
                    _jsxs(Text, {
                      dimColor: true,
                      children: ["[", log.timestamp.toLocaleTimeString(), "] "],
                    }),
                    _jsx(Text, { color: "red", children: log.message }),
                  ],
                },
                `log-${log.timestamp.getTime()}-${index}`,
              ),
            ),
          }),
    ],
  });
}
