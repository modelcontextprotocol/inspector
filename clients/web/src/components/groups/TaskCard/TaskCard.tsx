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
import { ContentViewer } from "../../elements/ContentViewer/ContentViewer";
import { ProgressDisplay } from "../../elements/ProgressDisplay/ProgressDisplay";
import { TaskStatusBadge } from "../../elements/TaskStatusBadge/TaskStatusBadge";

import type { TaskStatus } from "@modelcontextprotocol/sdk/types.js";
export type { TaskStatus };

export interface TaskCardProps {
  taskId: string;
  status: TaskStatus;
  method: string;
  target?: string;
  progress?: number;
  progressDescription?: string;
  startedAt?: string;
  completedAt?: string;
  lastUpdated?: string;
  elapsed?: string;
  ttl?: number;
  error?: string;
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

const ErrorText = Text.withProps({
  size: "sm",
  c: "red",
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

function buildTaskObject(props: TaskCardProps): string {
  const obj: Record<string, unknown> = {
    taskId: props.taskId,
    status: props.status,
    method: props.method,
  };
  if (props.target) obj.target = props.target;
  if (props.ttl !== undefined) obj.ttl = props.ttl;
  if (props.startedAt) obj.createdAt = props.startedAt;
  if (props.lastUpdated) obj.lastUpdatedAt = props.lastUpdated;
  if (props.completedAt) obj.completedAt = props.completedAt;
  if (props.progress !== undefined) obj.progress = props.progress;
  if (props.progressDescription) obj.statusMessage = props.progressDescription;
  if (props.error) obj.error = props.error;
  return JSON.stringify(obj);
}

export function TaskCard(props: TaskCardProps) {
  const {
    taskId,
    status,
    progress,
    progressDescription,
    startedAt,
    lastUpdated,
    ttl,
    error,
    isListExpanded,
    onCancel,
  } = props;

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
              <DetailLabel>Status</DetailLabel>
              <DetailValue>{status}</DetailValue>
            </Stack>
            {lastUpdated && (
              <Stack gap={2}>
                <DetailLabel>Last Updated</DetailLabel>
                <DetailValue>{lastUpdated}</DetailValue>
              </Stack>
            )}
            {startedAt && (
              <Stack gap={2}>
                <DetailLabel>Created At</DetailLabel>
                <DetailValue>{startedAt}</DetailValue>
              </Stack>
            )}
            {ttl !== undefined && (
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

        {progress !== undefined && isActive && (
          <ProgressDisplay
            params={{
              progress,
              message: progressDescription,
            }}
          />
        )}

        {isExpanded && (
          <Collapse in={isExpanded}>
            <Stack gap="sm">
              {progressDescription && !isActive && (
                <Stack gap={2}>
                  <DetailLabel>Status Message</DetailLabel>
                  <StatusMessageText>{progressDescription}</StatusMessageText>
                </Stack>
              )}

              {error && (
                <Stack gap={2}>
                  <DetailLabel>Error</DetailLabel>
                  <ErrorText>{error}</ErrorText>
                </Stack>
              )}

              <Divider />
              <SectionTitle>Full Task Object</SectionTitle>
              <ContentViewer
                block={{ type: "text", text: buildTaskObject(props) }}
                copyable
              />
            </Stack>
          </Collapse>
        )}
      </Stack>
    </TaskContainer>
  );
}
