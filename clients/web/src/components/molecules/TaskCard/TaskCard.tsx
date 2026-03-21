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
    <Card withBorder padding="md">
      <Stack gap="xs">
        <Group justify="space-between">
          <Group>
            <Text size="sm" ff="monospace">
              Task: {taskId}
            </Text>
            <Badge color={STATUS_COLORS[status]}>{status}</Badge>
          </Group>
          {progress !== undefined && <ProgressDisplay progress={progress} />}
        </Group>

        <Text size="sm" c="dimmed">
          Method:{" "}
          <Text component="span" fw={600}>
            {method}
          </Text>
        </Text>

        {target && (
          <Text size="sm" c="dimmed">
            Tool/Resource:{" "}
            <Text component="span" fw={600}>
              {target}
            </Text>
          </Text>
        )}

        {startedAt && (
          <Text size="sm" c="dimmed">
            Started: {startedAt}
            {completedAt && <> | Completed: {completedAt}</>}
            {elapsed && <> | Elapsed: {elapsed}</>}
          </Text>
        )}

        {progressDescription && (
          <Text size="sm" c="dimmed" fs="italic">
            {progressDescription}
          </Text>
        )}

        {error && (
          <Text size="sm" c="red">
            {error}
          </Text>
        )}

        <Group justify="flex-end">
          {isActive ? (
            <>
              <Button variant="subtle" size="xs" onClick={onViewDetails}>
                View Details
              </Button>
              <Button variant="subtle" color="red" size="xs" onClick={onCancel}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button variant="subtle" size="xs" onClick={onViewResult}>
                View Result
              </Button>
              <Button variant="subtle" size="xs" onClick={onDismiss}>
                Dismiss
              </Button>
            </>
          )}
        </Group>
      </Stack>
    </Card>
  );
}
