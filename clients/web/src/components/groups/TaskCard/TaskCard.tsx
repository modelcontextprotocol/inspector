import { useEffect, useState } from "react";
import {
  Button,
  Card,
  Collapse,
  Divider,
  Group,
  Stack,
  Text,
} from "@mantine/core";
import type { ProgressNotification, Task } from "@modelcontextprotocol/client";
import { ContentViewer } from "../../elements/ContentViewer/ContentViewer";
import { ExpandToggle } from "../../elements/ExpandToggle/ExpandToggle";
import { ProgressDisplay } from "../../elements/ProgressDisplay/ProgressDisplay";
import { TaskStatusBadge } from "../../elements/TaskStatusBadge/TaskStatusBadge";

export type TaskProgress = Pick<
  ProgressNotification["params"],
  "progress" | "total" | "message"
>;

export interface TaskCardProps {
  task: Task;
  progress?: TaskProgress;
  isListExpanded: boolean;
  onCancel: () => void;
  /**
   * Compact variant for the narrow monitoring sidebar. Moves the long task ID
   * out of the header onto its own line below it (truncated) so the header
   * doesn't wrap the status badge / Cancel Task control onto a second row. The
   * full-width Tasks screen keeps the ID inline in the header.
   */
  embedded?: boolean;
}

const TaskContainer = Card.withProps({
  withBorder: true,
  padding: "md",
  variant: "inset",
});

const HeaderRow = Group.withProps({
  justify: "space-between",
  wrap: "nowrap",
});

const TaskIdText = Text.withProps({
  size: "sm",
  ff: "monospace",
  c: "dimmed",
});

const DetailLabel = Text.withProps({
  size: "sm",
  c: "dimmed",
});

const DetailValue = Text.withProps({
  size: "sm",
  fw: 500,
});

const StatusMessageText = Text.withProps({
  size: "sm",
  fs: "italic",
});

const CancelButton = Button.withProps({
  variant: "subtle",
  color: "red",
  size: "xs",
});

const DetailRow = Group.withProps({
  gap: "xl",
  wrap: "wrap",
});

const SummaryRow = Group.withProps({
  justify: "space-between",
  wrap: "nowrap",
});

const HeaderLeftGroup = Group.withProps({
  gap: "sm",
});

const HeaderRightGroup = Group.withProps({
  gap: "xs",
  // Keep the Cancel Task control and the status badge together on the header's
  // first row rather than letting the badge wrap beneath the button.
  wrap: "nowrap",
});

const SectionTitle = Text.withProps({
  size: "sm",
  fw: 600,
});

function formatTaskId(taskId: string): string {
  return `ID: ${taskId}`;
}

function formatTtl(ttl: number): string {
  return `${ttl}ms`;
}

export function TaskCard({
  task,
  progress,
  isListExpanded,
  onCancel,
  embedded = false,
}: TaskCardProps) {
  const { taskId, status, ttl, createdAt, lastUpdatedAt, statusMessage } = task;
  const [isExpanded, setIsExpanded] = useState(isListExpanded);
  const isActive = status === "working" || status === "input_required";

  useEffect(() => {
    setIsExpanded(isListExpanded);
  }, [isListExpanded]);

  return (
    <TaskContainer>
      <Stack gap="sm">
        <HeaderRow>
          <HeaderLeftGroup>
            <SectionTitle>Task Details</SectionTitle>
            {/* Full-width screen: the id sits inline after the title. In the
                narrow embedded sidebar it moves to its own line below (see
                below) so it can't push the status badge / Cancel Task onto a
                second row. */}
            {!embedded && <TaskIdText>{formatTaskId(taskId)}</TaskIdText>}
          </HeaderLeftGroup>
          <HeaderRightGroup>
            {isActive && (
              <CancelButton onClick={onCancel}>Cancel Task</CancelButton>
            )}
            <TaskStatusBadge status={status} />
          </HeaderRightGroup>
        </HeaderRow>

        {embedded && (
          <TaskIdText truncate="end">{formatTaskId(taskId)}</TaskIdText>
        )}

        <SummaryRow>
          <DetailRow>
            <Stack gap={2}>
              <DetailLabel>Last Updated</DetailLabel>
              <DetailValue>{lastUpdatedAt}</DetailValue>
            </Stack>
            <Stack gap={2}>
              <DetailLabel>Created At</DetailLabel>
              <DetailValue>{createdAt}</DetailValue>
            </Stack>
            {ttl != null && (
              <Stack gap={2}>
                <DetailLabel>TTL</DetailLabel>
                <DetailValue>{formatTtl(ttl)}</DetailValue>
              </Stack>
            )}
          </DetailRow>
          <ExpandToggle
            expanded={isExpanded}
            onToggle={() => setIsExpanded((v) => !v)}
          />
        </SummaryRow>

        {progress && isActive ? (
          <ProgressDisplay params={progress} />
        ) : (
          statusMessage && (
            <StatusMessageText>{statusMessage}</StatusMessageText>
          )
        )}

        <Collapse in={isExpanded}>
          <Stack gap="sm">
            <Divider />
            <SectionTitle>Full Task Object</SectionTitle>
            <ContentViewer
              block={{ type: "text", text: JSON.stringify(task) }}
              copyable
            />
          </Stack>
        </Collapse>
      </Stack>
    </TaskContainer>
  );
}
