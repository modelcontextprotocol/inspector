import React, { useRef } from "react";
import { Box, Text, useInput, type Key } from "ink";
import { ScrollView, type ScrollViewRef } from "ink-scroll-view";
import { copyStatusColor, useCopyKeys } from "../hooks/useCopyKeys.js";

interface DetailsModalProps {
  title: string;
  content: React.ReactNode;
  width: number;
  height: number;
  onClose: () => void;
  /**
   * The raw text behind `content`, offered to Y (copy via OSC 52) and W (save
   * to a file) — #2421. Omit it and the modal offers no copy affordance.
   */
  copyText?: string;
}

export function DetailsModal({
  title,
  content,
  width,
  height,
  onClose,
  copyText,
}: DetailsModalProps) {
  const scrollViewRef = useRef<ScrollViewRef>(null);
  const { handleCopyKey, status: copyStatus } = useCopyKeys(
    copyText,
    "details",
  );

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
    (input: string, key: Key) => {
      if (key.escape) {
        onClose();
      } else if (handleCopyKey(input)) {
        return;
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

  return (
    <Box
      position="absolute"
      width={terminalDimensions.width}
      height={terminalDimensions.height}
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
    >
      {/* Modal Content */}
      <Box
        width={modalWidth}
        height={modalHeight}
        borderStyle="single"
        borderColor="cyan"
        flexDirection="column"
        paddingX={1}
        paddingY={1}
        backgroundColor="black"
      >
        {/* Header */}
        <Box flexShrink={0} marginBottom={1}>
          <Text bold color="cyan">
            {title}
          </Text>
          <Text> </Text>
          <Text dimColor>
            {copyText === undefined
              ? "(Press ESC to close)"
              : "(Press ESC to close, Y to copy, W to save to a file)"}
          </Text>
        </Box>

        {copyStatus && (
          <Box flexShrink={0} marginBottom={1}>
            <Text color={copyStatusColor(copyStatus.tone)}>
              {copyStatus.message}
            </Text>
          </Box>
        )}

        {/* Content Area */}
        <Box flexGrow={1} flexDirection="column" overflow="hidden">
          <ScrollView ref={scrollViewRef}>{content}</ScrollView>
        </Box>
      </Box>
    </Box>
  );
}
