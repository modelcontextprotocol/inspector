/**
 * The bottom line of the tool result view while saving a result (#2571): the
 * filename prompt `w` opens, or — once it closes — the outcome of the save.
 *
 * Its own component, rather than inline in `ToolTestModal`, because the modal
 * renders `position="absolute"`, which ink-testing-library lays out as an empty
 * frame. Split out, the prompt text and the confirmation / failure line can be
 * asserted on directly instead of only through their side effects.
 */
import React from "react";
import { Box, Text } from "ink";
import type { ResultFileFormat } from "@inspector/core/mcp/resultFile.js";

/** The open `w` filename prompt. */
export interface SavePrompt {
  path: string;
  format: ResultFileFormat;
  /** Whether the user has typed into the path, so Tab stops rewriting it. */
  edited: boolean;
}

/** The outcome line shown after a save attempt. */
export interface SaveStatus {
  ok: boolean;
  message: string;
}

interface SaveResultBarProps {
  prompt: SavePrompt | null;
  status: SaveStatus | null;
}

export function SaveResultBar({ prompt, status }: SaveResultBarProps) {
  if (prompt) {
    return (
      <Box flexShrink={0} flexDirection="column">
        <Text>
          <Text bold color="cyan">
            Save as {prompt.format}:{" "}
          </Text>
          <Text>{prompt.path}</Text>
          <Text inverse> </Text>
        </Text>
        <Text dimColor>
          Enter to save, Tab to switch json/raw, ESC to cancel
        </Text>
      </Box>
    );
  }
  if (status) {
    return (
      <Box flexShrink={0}>
        <Text color={status.ok ? "green" : "red"}>{status.message}</Text>
      </Box>
    );
  }
  return null;
}
