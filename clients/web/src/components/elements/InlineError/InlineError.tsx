import {
  Alert,
  Button,
  Collapse,
  Group,
  Stack,
  Text,
  Transition,
} from "@mantine/core";
import { useEffect, useState } from "react";

export interface InlineErrorProps {
  error: { message: string; data?: unknown };
  retryCount?: number;
  maxRetries?: number;
  docLink?: string;
  /**
   * When set, the alert slides up + fades out after this many ms.
   * Resets whenever `error.message` changes so a fresh error always
   * starts a new countdown.
   */
  autoDismissMs?: number;
}

const HeaderRow = Group.withProps({
  justify: "space-between",
  wrap: "nowrap",
});

const MessageGroup = Group.withProps({
  gap: "sm",
  wrap: "nowrap",
});

const ErrorMessage = Text.withProps({
  size: "sm",
  fw: 500,
  c: "red",
});

const RetryText = Text.withProps({
  size: "sm",
  c: "dimmed",
});

const ExpandButton = Button.withProps({
  variant: "transparent",
  size: "compact-xs",
  c: "var(--inspector-text-primary)",
});

const DocLinkButton = Button.withProps({
  variant: "light",
  size: "xs",
  component: "a",
  target: "_blank",
});

function formatRetryLabel(retryCount: number, maxRetries?: number): string {
  return maxRetries !== undefined
    ? `Retry attempt ${retryCount} of ${maxRetries}`
    : `Retry attempt ${retryCount}`;
}

function formatDetails(data: unknown): string {
  if (typeof data === "string") return data;
  return JSON.stringify(data, null, 2);
}

export function InlineError({
  error,
  retryCount,
  maxRetries,
  docLink,
  autoDismissMs,
}: InlineErrorProps) {
  const [expanded, setExpanded] = useState(false);
  // Derive visibility from "which message has been dismissed". A new
  // error message makes `dismissedMessage` stale and the alert renders;
  // when the timer fires we mark this message dismissed and the
  // Transition runs its exit animation. Doing it this way (vs. a
  // mounted boolean + setMounted(true) on message change) avoids the
  // forbidden setState-in-effect pattern.
  const [dismissedMessage, setDismissedMessage] = useState<string | undefined>(
    undefined,
  );
  const mounted = error.message !== dismissedMessage;
  const details =
    error.data !== undefined ? formatDetails(error.data) : undefined;
  const hasExpandable = details !== undefined || docLink !== undefined;

  useEffect(() => {
    if (!autoDismissMs) return;
    const timer = setTimeout(
      () => setDismissedMessage(error.message),
      autoDismissMs,
    );
    return () => clearTimeout(timer);
  }, [autoDismissMs, error.message]);

  return (
    <Transition
      mounted={mounted}
      transition="slide-up"
      duration={350}
      timingFunction="ease"
    >
      {(transitionStyle) => (
        <Alert color="red" variant="light" style={transitionStyle}>
          <Stack gap="xs">
            <HeaderRow>
              <MessageGroup>
                <ErrorMessage>{error.message}</ErrorMessage>
                {retryCount !== undefined && (
                  <RetryText>
                    {formatRetryLabel(retryCount, maxRetries)}
                  </RetryText>
                )}
              </MessageGroup>
              {hasExpandable && (
                <ExpandButton onClick={() => setExpanded((v) => !v)}>
                  {expanded ? "Show less" : "Show more"}
                </ExpandButton>
              )}
            </HeaderRow>
            <Collapse in={expanded}>
              <Stack gap="xs">
                {details && <Text size="sm">{details}</Text>}
                {docLink && (
                  <DocLinkButton href={docLink}>
                    View Troubleshooting Guide
                  </DocLinkButton>
                )}
              </Stack>
            </Collapse>
          </Stack>
        </Alert>
      )}
    </Transition>
  );
}
