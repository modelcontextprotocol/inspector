import { Alert, Button, Collapse, Group, Stack, Text } from "@mantine/core";
import { useState } from "react";

export interface InlineErrorProps {
  message: string;
  details?: string;
  retryCount?: number;
  maxRetries?: number;
  docLink?: string;
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

export function InlineError({
  message,
  details,
  retryCount,
  maxRetries,
  docLink,
}: InlineErrorProps) {
  const [expanded, setExpanded] = useState(false);
  const hasExpandable = details !== undefined || docLink !== undefined;

  return (
    <Alert color="red" variant="light">
      <Stack gap="xs">
        <HeaderRow>
          <MessageGroup>
            <ErrorMessage>{message}</ErrorMessage>
            {retryCount !== undefined && (
              <RetryText>{formatRetryLabel(retryCount, maxRetries)}</RetryText>
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
  );
}
