import { Group, Stack, Text, Title } from "@mantine/core";
import { AnnotationBadge } from "../../atoms/AnnotationBadge/AnnotationBadge";
import { ContentViewer } from "../../atoms/ContentViewer/ContentViewer";
import { CopyButton } from "../../atoms/CopyButton/CopyButton";
import { SubscribeButton } from "../../atoms/SubscribeButton/SubscribeButton";

export interface ResourcePreviewPanelProps {
  uri: string;
  mimeType: string;
  annotations?: { audience?: string; priority?: number };
  content: string;
  lastUpdated?: string;
  isSubscribed: boolean;
  onSubscribe: () => void;
  onUnsubscribe: () => void;
}

function priorityLabel(priority: number): string {
  if (priority >= 0.7) return "priority: high";
  if (priority >= 0.4) return "priority: medium";
  return "priority: low";
}

function resolveContentType(mimeType: string): "json" | "image" | "text" {
  if (mimeType === "application/json") return "json";
  if (mimeType.startsWith("image/")) return "image";
  return "text";
}

export function ResourcePreviewPanel({
  uri,
  mimeType,
  annotations,
  content,
  lastUpdated,
  isSubscribed,
  onSubscribe,
  onUnsubscribe,
}: ResourcePreviewPanelProps) {
  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="nowrap">
        <Title order={4}>Resource</Title>
        <Group gap="xs" wrap="nowrap">
          <Text size="sm" c="blue" truncate="end">
            {uri}
          </Text>
          <CopyButton value={uri} />
        </Group>
      </Group>
      <ContentViewer
        type={resolveContentType(mimeType)}
        content={content}
        mimeType={mimeType}
        copyable
      />
      <Group justify="space-between" wrap="nowrap">
        {lastUpdated ? (
          <Text size="xs" c="dimmed">
            Last updated: {lastUpdated}
          </Text>
        ) : (
          <span />
        )}
        <Text size="sm" c="dimmed">
          {mimeType}
        </Text>
      </Group>
      <Group justify="space-between">
        <Group gap="xs">
          {annotations?.audience && (
            <AnnotationBadge
              label={annotations.audience}
              variant="audience"
            />
          )}
          {annotations?.priority !== undefined && (
            <AnnotationBadge
              label={priorityLabel(annotations.priority)}
              variant="priority"
            />
          )}
        </Group>
        <SubscribeButton
          subscribed={isSubscribed}
          onToggle={isSubscribed ? onUnsubscribe : onSubscribe}
        />
      </Group>
    </Stack>
  );
}
