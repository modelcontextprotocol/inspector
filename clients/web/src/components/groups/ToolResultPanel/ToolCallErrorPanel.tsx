import {
  Alert,
  CloseButton,
  Code,
  Group,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { classifyToolCallError } from "./toolResultUtils";

export interface ToolCallErrorPanelProps {
  /** The thrown error's message (already stringified in App). */
  error: string;
  /**
   * The JSON-RPC error code, when the throw was a `ProtocolError`. Under SDK v2
   * an unknown-tool `tools/call` REJECTS with `-32602 Invalid params` instead of
   * resolving an `isError` result, so it arrives here as a thrown error rather
   * than a `CallToolResult` (which the ToolResultPanel would render). The same
   * `-32602` is also thrown for a known tool called with invalid arguments, so
   * the heading/hint are chosen from the message, not the code alone.
   */
  errorCode?: number;
  /** Dismiss the error and return to the input form (mirrors ToolResultPanel). */
  onClear: () => void;
}

// Mirrors ToolResultPanel's column so an error dismisses the same way a result
// does: header with the close X pins, the alert fills and scrolls below it.
const PanelStack = Stack.withProps({
  gap: "md",
  miw: 0,
  mih: 0,
  flex: 1,
});

const HeaderRow = Group.withProps({
  gap: "xs",
  wrap: "nowrap",
  flex: "0 0 auto",
});

const HintText = Text.withProps({
  size: "sm",
  c: "var(--inspector-text-secondary)",
});

/**
 * Renders a thrown tool-call error (a protocol/SDK-level rejection) as a
 * distinct error panel. This is separate from ToolResultPanel, which renders a
 * `CallToolResult` (including a tool-level `isError` result). An `-32602`
 * rejection carries no result, so it would otherwise be invisible.
 */
const ERROR_TITLES: Record<string, string> = {
  "unknown-tool": "Unknown Tool",
  "invalid-params": "Invalid Parameters",
  generic: "Tool Error",
};

export function ToolCallErrorPanel({
  error,
  errorCode,
  onClear,
}: ToolCallErrorPanelProps) {
  const kind = classifyToolCallError(errorCode, error);
  return (
    <PanelStack>
      <HeaderRow>
        <CloseButton aria-label="Close error" onClick={onClear} />
        {/* h3 (not h4), size h4: request modals open over the Tools screen with
            an `h2` `Modal.Title`, so an `h4` here would skip a level (axe
            `heading-order`); `size="h4"` keeps the visual size. */}
        <Title order={3} size="h4">
          Tool Call Failed
        </Title>
      </HeaderRow>
      <Alert color="red" variant="light" title={ERROR_TITLES[kind]}>
        <Stack gap="xs">
          <Text size="sm">{error}</Text>
          {kind === "unknown-tool" && (
            <HintText>
              The server rejected this call with <Code>-32602</Code> (Invalid
              params) — it does not recognize this tool. It may have been
              excluded for an invalid <Code>x-mcp-header</Code> annotation or
              removed since the list was last fetched. Try refreshing the tools
              list.
            </HintText>
          )}
          {kind === "invalid-params" && (
            <HintText>
              The server rejected this call with <Code>-32602</Code> (Invalid
              params). Check the argument values against the tool&apos;s schema.
            </HintText>
          )}
        </Stack>
      </Alert>
    </PanelStack>
  );
}
