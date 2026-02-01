import React from "react";
import { Box, Text } from "ink";

/** Renders a selectable item: ▶ + space when selected, space + space when not. Fixed width to prevent layout shift. */
export function SelectableItem({
  isSelected,
  bold,
  children,
}: {
  isSelected: boolean;
  bold?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Box flexShrink={0} flexDirection="row">
      <Box width={2}>
        <Text bold={bold}>{isSelected ? "▶ " : "  "}</Text>
      </Box>
      <Text bold={bold}>{children}</Text>
    </Box>
  );
}
