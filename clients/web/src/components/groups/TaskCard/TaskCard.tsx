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
import type {
  ProgressNotification,
  Task,
} from "@modelcontextprotocol/sdk/types.js";
import { ContentViewer } from "../../elements/ContentViewer/ContentViewer";
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
}

const TaskContainer = Card.withProps({
  withBorder: true,
  padding: "md",
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

const SubtleButton = Button.withProps({
  variant: "subtle",
  size: "xs",
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
            <TaskIdText>{formatTaskId(taskId)}</TaskIdText>
          </HeaderLeftGroup>
          <HeaderRightGroup>
            {isActive && (
              <CancelButton onClick={onCancel}>Cancel Task</CancelButton>
            )}
            <TaskStatusBadge status={status} />
          </HeaderRightGroup>
        </HeaderRow>

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
          <SubtleButton onClick={() => setIsExpanded((v) => !v)}>
            {isExpanded ? "Collapse" : "Expand"}
          </SubtleButton>
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
