import { Badge, useComputedColorScheme } from "@mantine/core";
import type { TaskStatus } from "../../groups/TaskCard/TaskCard";

export interface TaskStatusBadgeProps {
  status: TaskStatus;
}

const statusColor: Record<TaskStatus, string> = {
  waiting: "gray",
  running: "blue",
  completed: "green",
  failed: "red",
  cancelled: "yellow",
};

export function TaskStatusBadge({ status }: TaskStatusBadgeProps) {
  const colorScheme = useComputedColorScheme();
  const textColor = colorScheme === "dark" ? "black" : "white";

  return (
    <Badge color={statusColor[status]} variant="filled" c={textColor}>
      {status}
    </Badge>
  );
}
