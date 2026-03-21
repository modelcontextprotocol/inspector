import { Group, Progress, Stack, Text } from "@mantine/core";

export interface ProgressDisplayProps {
  progress: number;
  description?: string;
  elapsed?: string;
}

export function ProgressDisplay({
  progress,
  description,
  elapsed,
}: ProgressDisplayProps) {
  return (
    <Stack gap="xs">
      <Group justify="space-between">
        {description && (
          <Text size="sm" c="dimmed">
            {description}
          </Text>
        )}
        <Text size="sm" c="dimmed">
          {progress}%
        </Text>
      </Group>
      <Progress value={progress} size="sm" />
      {elapsed && (
        <Text size="xs" c="dimmed">
          {elapsed}
        </Text>
      )}
    </Stack>
  );
}
