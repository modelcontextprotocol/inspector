import { Button, Flex, Group, Stack, Text, Title } from "@mantine/core";
import { AnnotationBadge } from "../../elements/AnnotationBadge/AnnotationBadge";
import { ContentViewer } from "../../elements/ContentViewer/ContentViewer";
import { CopyButton } from "../../elements/CopyButton/CopyButton";
import { SubscribeButton } from "../../elements/SubscribeButton/SubscribeButton";

export interface ResourcePreviewPanelProps {
  uri: string;
  mimeType: string;
  annotations?: { audience?: string; priority?: number };
  content: string;
  lastUpdated?: string;
  isSubscribed: boolean;
  onRefresh: () => void;
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

function formatLastUpdated(lastUpdated: string): string {
  return `Last updated: ${lastUpdated}`;
}

const HeaderRow = Group.withProps({
  justify: "space-between",
  wrap: "nowrap",
});

const UriGroup = Group.withProps({
  gap: "xs",
  wrap: "nowrap",
});

const UriText = Text.withProps({
  size: "sm",
  c: "blue",
  truncate: "end",
});

const MetaRow = Group.withProps({
  justify: "space-between",
  wrap: "nowrap",
});

const TimestampText = Text.withProps({
  size: "xs",
  c: "dimmed",
});

const MimeText = Text.withProps({
  size: "sm",
  c: "dimmed",
});

const FooterRow = Group.withProps({
  justify: "space-between",
});

const AnnotationGroup = Group.withProps({
  gap: "xs",
});

const ActionGroup = Group.withProps({
  gap: "xs",
});

const Spacer = Flex.withProps({});

export function ResourcePreviewPanel({
  uri,
  mimeType,
  annotations,
  content,
  lastUpdated,
  isSubscribed,
  onRefresh,
  onSubscribe,
  onUnsubscribe,
}: ResourcePreviewPanelProps) {
  return (
    <Stack gap="md">
      <HeaderRow>
        <Title order={4}>Resource</Title>
        <UriGroup>
          <UriText>{uri}</UriText>
          <CopyButton value={uri} />
        </UriGroup>
      </HeaderRow>
      <ContentViewer
        type={resolveContentType(mimeType)}
        content={content}
        mimeType={mimeType}
        copyable
      />
      <MetaRow>
        {lastUpdated ? (
          <TimestampText>{formatLastUpdated(lastUpdated)}</TimestampText>
        ) : (
          <Spacer />
        )}
        <MimeText>{mimeType}</MimeText>
      </MetaRow>
      <FooterRow>
        <AnnotationGroup>
          {annotations?.audience && (
            <AnnotationBadge label={annotations.audience} variant="audience" />
          )}
          {annotations?.priority !== undefined && (
            <AnnotationBadge
              label={priorityLabel(annotations.priority)}
              variant="priority"
            />
          )}
        </AnnotationGroup>
        <ActionGroup>
          <Button variant="subtle" size="sm" onClick={onRefresh}>
            Refresh
          </Button>
          <SubscribeButton
            subscribed={isSubscribed}
            onToggle={isSubscribed ? onUnsubscribe : onSubscribe}
          />
        </ActionGroup>
      </FooterRow>
    </Stack>
  );
}
