import { Badge } from "@mantine/core";
import type { TaskStatus } from "@modelcontextprotocol/client";
import { filledBadgeColor } from "../filledBadgeColor";

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
  // `autoContrast` keeps the label legible (WCAG AA) on both the light-mode
  // fills and the darker dark-mode `-filled` shades — see AnnotationBadge.
  return (
    <Badge
      color={filledBadgeColor(statusColor[status])}
      variant="filled"
      autoContrast
    >
      {statusLabel[status]}
    </Badge>
  );
}
