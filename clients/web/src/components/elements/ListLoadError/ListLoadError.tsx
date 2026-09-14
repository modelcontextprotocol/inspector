import { Alert, Button, Code, ScrollArea, Stack } from "@mantine/core";

export interface ListLoadErrorProps {
  /**
   * The failed load's error, or `null`/`undefined` when the last load
   * succeeded (renders nothing).
   */
  error?: Error | null;
  /** What failed to load, for the alert title — e.g. "tools", "prompts". */
  what: string;
  /** Retry the load. Omit to render the alert without a retry affordance. */
  onRetry?: () => void;
}

// `variant="light"` + red: an error the user can act on (retry), not a fatal
// one. Sits above the list rather than replacing it — a stale list plus a
// visible "this didn't reload" beats an empty panel that looks like an answer.
const ErrorAlert = Alert.withProps({
  color: "red",
  variant: "light",
});

// The raw message, monospaced and wrapping: these are validation failures
// (JSON paths, schema expectations) where the exact text is the diagnostic.
const ErrorMessage = Code.withProps({
  block: true,
  variant: "wrapping",
});

// Caps the message: a schema-validation failure serializes to a dozen-plus
// lines, which would otherwise push the list itself off the sidebar.
const MessageScroll = ScrollArea.withProps({
  mah: 180,
  type: "auto",
});

const RetryButton = Button.withProps({
  size: "xs",
  variant: "light",
  color: "red",
  w: "fit-content",
});

/**
 * The list panel's "couldn't load" state (#1953).
 *
 * A list fetch that fails — a transport error, or a result the SDK codec
 * rejects as invalid for the negotiated protocol era — used to leave the panel
 * empty, which is indistinguishable from a server that legitimately has no
 * tools/prompts/resources. This says what happened and offers a retry.
 */
export function ListLoadError({ error, what, onRetry }: ListLoadErrorProps) {
  if (!error) return null;

  return (
    <ErrorAlert title={`Couldn't load ${what}`}>
      <Stack gap="xs">
        <MessageScroll>
          <ErrorMessage>{error.message}</ErrorMessage>
        </MessageScroll>
        {onRetry && <RetryButton onClick={onRetry}>Retry</RetryButton>}
      </Stack>
    </ErrorAlert>
  );
}
