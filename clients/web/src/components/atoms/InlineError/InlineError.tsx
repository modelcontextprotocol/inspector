import { Alert, Button, Collapse, Group, Stack, Text } from "@mantine/core";
import { useState } from "react";

export interface InlineErrorProps {
  message: string;
  details?: string;
  retryCount?: number;
  maxRetries?: number;
  docLink?: string;
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
        <Group justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Text size="sm" fw={500} c="red">
              {message}
            </Text>
            {retryCount !== undefined && (
              <Text size="sm" c="dimmed">
                Retry attempt {retryCount}
                {maxRetries !== undefined && ` of ${maxRetries}`}
              </Text>
            )}
          </Group>
          {hasExpandable && (
            <Button
              variant="transparent"
              size="compact-xs"
              c="dark"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Show less" : "Show more"}
            </Button>
          )}
        </Group>
        <Collapse in={expanded}>
          <Stack gap="xs">
            {details && <Text size="sm">{details}</Text>}
            {docLink && (
              <Button
                variant="light"
                size="xs"
                component="a"
                href={docLink}
                target="_blank"
              >
                View Troubleshooting Guide
              </Button>
            )}
          </Stack>
        </Collapse>
      </Stack>
    </Alert>
  );
}
