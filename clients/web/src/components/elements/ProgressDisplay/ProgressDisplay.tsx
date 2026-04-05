import { Group, Progress, Stack, Text } from "@mantine/core";

export interface ProgressDisplayProps {
  progress: number;
  description?: string;
  elapsed?: string;
}

function formatPercent(progress: number): string {
  return `${progress}%`;
}

const ProgressLabel = Text.withProps({
  size: "sm",
  c: "dimmed",
});

const ElapsedText = Text.withProps({
  size: "xs",
  c: "dimmed",
});

export function ProgressDisplay({
  progress,
  description,
  elapsed,
}: ProgressDisplayProps) {
  return (
    <Stack gap="xs">
      <Group justify="space-between">
        {description && <ProgressLabel>{description}</ProgressLabel>}
        <ProgressLabel>{formatPercent(progress)}</ProgressLabel>
      </Group>
      <Progress value={progress} size="sm" />
      {elapsed && <ElapsedText>{elapsed}</ElapsedText>}
    </Stack>
  );
}
