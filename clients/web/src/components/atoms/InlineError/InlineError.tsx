import { Alert, Anchor, Group, Spoiler, Stack, Text } from "@mantine/core";

export interface InlineErrorProps {
  message: string;
  details?: string;
  retryCount?: number;
  maxRetries?: number;
  onShowMore?: () => void;
  docLink?: string;
}

export function InlineError({
  message,
  details,
  retryCount,
  maxRetries,
  docLink,
}: InlineErrorProps) {
  const hasDetails =
    retryCount !== undefined || details !== undefined || docLink !== undefined;

  return (
    <Alert color="red" variant="light" title={message}>
      {hasDetails && (
        <Stack gap="xs">
          {retryCount !== undefined && (
            <Text size="sm">
              Retry attempt {retryCount}
              {maxRetries !== undefined && ` of ${maxRetries}`}
            </Text>
          )}
          {details && (
            <Spoiler maxHeight={0} showLabel="Show more" hideLabel="Show less">
              <Text size="sm">{details}</Text>
            </Spoiler>
          )}
          {docLink && (
            <Group>
              <Anchor href={docLink} target="_blank" size="sm">
                View Troubleshooting Guide &rarr;
              </Anchor>
            </Group>
          )}
        </Stack>
      )}
    </Alert>
  );
}
