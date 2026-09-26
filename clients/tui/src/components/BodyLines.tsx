import React from "react";
import { Box, Text } from "ink";
import { layoutBody } from "../utils/bodyLines.js";

/**
 * Renders a request/response body as indented, dimmed lines with a bounded
 * component count (#2407) — see `utils/bodyLines.ts` for the caps and why both
 * exist. Shared by the Requests tab and the App details view, which previously
 * carried four copies of an uncapped line map.
 */
export function BodyLines({
  body,
  keyPrefix,
}: {
  body: string;
  keyPrefix: string;
}) {
  const { lines, hiddenLines, totalLines } = layoutBody(body);
  return (
    <>
      {lines.map((line, idx) => (
        <Box
          key={`${keyPrefix}-${idx}`}
          marginTop={idx === 0 ? 1 : 0}
          paddingLeft={2}
          flexShrink={0}
        >
          <Text dimColor>{line}</Text>
        </Box>
      ))}
      {hiddenLines > 0 && (
        <Box paddingLeft={2} flexShrink={0}>
          <Text dimColor italic>
            … {hiddenLines} more lines not shown ({totalLines} total)
          </Text>
        </Box>
      )}
    </>
  );
}
