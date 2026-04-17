import { Group, Progress, Stack, Text } from "@mantine/core";
import type { ProgressNotification } from "@modelcontextprotocol/sdk/types.js";

export interface ProgressDisplayProps {
  params: ProgressNotification["params"];
  elapsed?: string;
}

function computePercent(progress: number, total?: number): number {
  if (total != null && total > 0) {
    return Math.round((progress / total) * 100);
  }
  return progress;
}

function formatPercent(percent: number): string {
  return `${percent}%`;
}

const ProgressLabel = Text.withProps({
  size: "sm",
  c: "dimmed",
});

const ElapsedText = Text.withProps({
  size: "xs",
  c: "dimmed",
});

export function ProgressDisplay({ params, elapsed }: ProgressDisplayProps) {
  const percent = computePercent(params.progress, params.total);

  return (
    <Stack gap="xs">
      <Group justify="space-between">
        {params.message && <ProgressLabel>{params.message}</ProgressLabel>}
        <ProgressLabel>{formatPercent(percent)}</ProgressLabel>
      </Group>
      <Progress value={percent} size="sm" />
      {elapsed && <ElapsedText>{elapsed}</ElapsedText>}
    </Stack>
  );
}
