/**
 * The `?` keybinding help overlay (#2436).
 *
 * A full-screen overlay, drawn the same way as `DetailsModal`, listing the
 * bindings `utils/keybindings.ts` returns for the active tab. It renders data
 * and owns no knowledge of which keys exist: a new binding is a row in that
 * table, never an edit here.
 *
 * It closes on `?` (the key that opened it) or Esc, and scrolls when the list
 * is taller than the terminal. Keeping the panes underneath inert while it is
 * open is `App`'s job — it moves focus off them — because the overlay cannot
 * stop other `useInput` handlers from seeing a key.
 */
import React, { useRef } from "react";
import { Box, Text, useInput, type Key } from "ink";
import { ScrollView, type ScrollViewRef } from "ink-scroll-view";
import {
  keyColumnWidth,
  type KeyBindingSection,
} from "../utils/keybindings.js";

interface HelpOverlayProps {
  sections: readonly KeyBindingSection[];
  width: number;
  height: number;
  onClose: () => void;
}

/** Gap between the keys column and the action column. */
const COLUMN_GAP = 2;

export function HelpOverlay({
  sections,
  width,
  height,
  onClose,
}: HelpOverlayProps) {
  const scrollViewRef = useRef<ScrollViewRef>(null);
  const keysWidth = keyColumnWidth(sections) + COLUMN_GAP;

  useInput((input: string, key: Key) => {
    // The ref is set once the ScrollView mounts; `?.` short-circuits the
    // whole call, arguments included, on the render before that.
    const view = scrollViewRef.current;
    if (key.escape || input === "?") {
      onClose();
    } else if (key.downArrow) {
      view?.scrollBy(1);
    } else if (key.upArrow) {
      view?.scrollBy(-1);
    } else if (key.pageDown) {
      view?.scrollBy(view.getViewportHeight());
    } else if (key.pageUp) {
      view?.scrollBy(-view.getViewportHeight());
    }
  });

  return (
    <Box
      position="absolute"
      width={width}
      height={height}
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
    >
      <Box
        width={width - 2}
        height={height - 2}
        borderStyle="single"
        borderColor="cyan"
        flexDirection="column"
        paddingX={1}
        paddingY={1}
        backgroundColor="black"
      >
        <Box flexShrink={0} marginBottom={1}>
          <Text bold color="cyan">
            Keyboard shortcuts
          </Text>
          <Text> </Text>
          <Text dimColor>(Press ? or ESC to close)</Text>
        </Box>

        <Box flexGrow={1} flexDirection="column" overflow="hidden">
          <ScrollView ref={scrollViewRef}>
            {sections.map((section) => (
              <Box key={section.title} flexDirection="column" marginBottom={1}>
                <Text bold underline>
                  {section.title}
                </Text>
                {section.bindings.map((binding) => (
                  <Box key={`${binding.keys}:${binding.action}`}>
                    <Box width={keysWidth} flexShrink={0}>
                      <Text color="yellow">{binding.keys}</Text>
                    </Box>
                    <Text>{binding.action}</Text>
                  </Box>
                ))}
              </Box>
            ))}
          </ScrollView>
        </Box>
      </Box>
    </Box>
  );
}
