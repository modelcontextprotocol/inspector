import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useRef } from "react";
import { Box, Text, useInput } from "ink";
import { ScrollView } from "ink-scroll-view";
export function DetailsModal({ title, content, width, height, onClose }) {
  const scrollViewRef = useRef(null);
  // Use full terminal dimensions
  const [terminalDimensions, setTerminalDimensions] = React.useState({
    width: process.stdout.columns || width,
    height: process.stdout.rows || height,
  });
  React.useEffect(() => {
    const updateDimensions = () => {
      setTerminalDimensions({
        width: process.stdout.columns || width,
        height: process.stdout.rows || height,
      });
    };
    process.stdout.on("resize", updateDimensions);
    updateDimensions();
    return () => {
      process.stdout.off("resize", updateDimensions);
    };
  }, [width, height]);
  // Handle escape to close and scrolling
  useInput(
    (input, key) => {
      if (key.escape) {
        onClose();
      } else if (key.downArrow) {
        scrollViewRef.current?.scrollBy(1);
      } else if (key.upArrow) {
        scrollViewRef.current?.scrollBy(-1);
      } else if (key.pageDown) {
        const viewportHeight = scrollViewRef.current?.getViewportHeight() || 1;
        scrollViewRef.current?.scrollBy(viewportHeight);
      } else if (key.pageUp) {
        const viewportHeight = scrollViewRef.current?.getViewportHeight() || 1;
        scrollViewRef.current?.scrollBy(-viewportHeight);
      }
    },
    { isActive: true },
  );
  // Calculate modal dimensions - use almost full screen
  const modalWidth = terminalDimensions.width - 2;
  const modalHeight = terminalDimensions.height - 2;
  return _jsx(Box, {
    position: "absolute",
    width: terminalDimensions.width,
    height: terminalDimensions.height,
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    children: _jsxs(Box, {
      width: modalWidth,
      height: modalHeight,
      borderStyle: "single",
      borderColor: "cyan",
      flexDirection: "column",
      paddingX: 1,
      paddingY: 1,
      backgroundColor: "black",
      children: [
        _jsxs(Box, {
          flexShrink: 0,
          marginBottom: 1,
          children: [
            _jsx(Text, { bold: true, color: "cyan", children: title }),
            _jsx(Text, { children: " " }),
            _jsx(Text, { dimColor: true, children: "(Press ESC to close)" }),
          ],
        }),
        _jsx(Box, {
          flexGrow: 1,
          flexDirection: "column",
          overflow: "hidden",
          children: _jsx(ScrollView, { ref: scrollViewRef, children: content }),
        }),
      ],
    }),
  });
}
