import { Badge, Button, Card, Group, Stack, Text } from "@mantine/core";
import { ProgressDisplay } from "../../atoms/ProgressDisplay/ProgressDisplay";

export type TaskStatus =
  | "waiting"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface TaskCardProps {
  taskId: string;
  status: TaskStatus;
  method: string;
  target?: string;
  progress?: number;
  progressDescription?: string;
  startedAt?: string;
  completedAt?: string;
  elapsed?: string;
  error?: string;
  onViewDetails: () => void;
  onViewResult: () => void;
  onCancel: () => void;
  onDismiss: () => void;
}

const STATUS_COLORS: Record<TaskStatus, string> = {
  waiting: "gray",
  running: "blue",
  completed: "green",
  failed: "red",
  cancelled: "yellow",
};

const TaskContainer = Card.withProps({
  withBorder: true,
  padding: "md",
});

const TaskIdText = Text.withProps({
  size: "sm",
  ff: "monospace",
});

const DetailText = Text.withProps({
  size: "sm",
  c: "dimmed",
});

const ValueSpan = Text.withProps({
  component: "span",
  fw: 600,
});

const ProgressNote = Text.withProps({
  size: "sm",
  c: "dimmed",
  fs: "italic",
});

const SubtleButton = Button.withProps({
  variant: "subtle",
  size: "xs",
});

const CancelButton = Button.withProps({
  variant: "subtle",
  color: "red",
  size: "xs",
});

function formatTaskId(taskId: string): string {
  return `Task: ${taskId}`;
}

function formatTimeline(
  startedAt: string,
  completedAt?: string,
  elapsed?: string,
): string {
  let result = `Started: ${startedAt}`;
  if (completedAt) result += ` | Completed: ${completedAt}`;
  if (elapsed) result += ` | Elapsed: ${elapsed}`;
  return result;
}

export function TaskCard({
  taskId,
  status,
  method,
  target,
  progress,
  progressDescription,
  startedAt,
  completedAt,
  elapsed,
  error,
  onViewDetails,
  onViewResult,
  onCancel,
  onDismiss,
}: TaskCardProps) {
  const isActive = status === "waiting" || status === "running";

  return (
    <TaskContainer>
      <Stack gap="xs">
        <Group justify="space-between">
          <Group>
            <TaskIdText>{formatTaskId(taskId)}</TaskIdText>
            <Badge color={STATUS_COLORS[status]}>{status}</Badge>
          </Group>
          {progress !== undefined && <ProgressDisplay progress={progress} />}
        </Group>

        <DetailText>
          Method: <ValueSpan>{method}</ValueSpan>
        </DetailText>

        {target && (
          <DetailText>
            Tool/Resource: <ValueSpan>{target}</ValueSpan>
          </DetailText>
        )}

        {startedAt && (
          <DetailText>
            {formatTimeline(startedAt, completedAt, elapsed)}
          </DetailText>
        )}

        {progressDescription && (
          <ProgressNote>{progressDescription}</ProgressNote>
        )}

        {error && (
          <Text size="sm" c="red">
            {error}
          </Text>
        )}

        <Group justify="flex-end">
          {isActive ? (
            <>
              <SubtleButton onClick={onViewDetails}>View Details</SubtleButton>
              <CancelButton onClick={onCancel}>Cancel</CancelButton>
            </>
          ) : (
            <>
              <SubtleButton onClick={onViewResult}>View Result</SubtleButton>
              <SubtleButton onClick={onDismiss}>Dismiss</SubtleButton>
            </>
          )}
        </Group>
      </Stack>
    </TaskContainer>
  );
}
