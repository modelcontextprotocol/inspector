import React from "react";
import { Box, Text } from "ink";

/**
 * Fills a region with a solid background color using Text (Ink 5 Box has no backgroundColor).
 * Use as the first child behind modal content so the dialog obscures the page.
 */
export function ModalBackdrop({
  width,
  height,
  color = "black",
}: {
  width: number;
  height: number;
  color?: string;
}) {
  const line = " ".repeat(Math.max(0, width));
  return (
    <Box
      position="absolute"
      width={width}
      height={height}
      flexDirection="column"
    >
      {Array.from({ length: height }, (_, i) => (
        <Text key={i} backgroundColor={color}>
          {line}
        </Text>
      ))}
    </Box>
  );
}
