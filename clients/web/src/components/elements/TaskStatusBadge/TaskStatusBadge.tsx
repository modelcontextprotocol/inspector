import { Badge, useComputedColorScheme } from "@mantine/core";
import type { TaskStatus } from "@modelcontextprotocol/sdk/types.js";

export interface TaskStatusBadgeProps {
  status: TaskStatus;
}

const statusColor: Record<TaskStatus, string> = {
  working: "blue",
  input_required: "yellow",
  completed: "green",
  failed: "red",
  cancelled: "gray",
};

const statusLabel: Record<TaskStatus, string> = {
  working: "working",
  input_required: "input required",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
};

export function TaskStatusBadge({ status }: TaskStatusBadgeProps) {
  const colorScheme = useComputedColorScheme();
  const textColor = colorScheme === "dark" ? "black" : "white";

  return (
    <Badge color={statusColor[status]} variant="filled" c={textColor}>
      {statusLabel[status]}
    </Badge>
  );
}
