import { Button, Flex, Group, Stack, Text, Title } from "@mantine/core";
import type { ContentBlock } from "@modelcontextprotocol/sdk/types.js";
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

function toContentBlock(content: string, mimeType: string): ContentBlock {
  if (mimeType.startsWith("image/")) {
    return { type: "image", data: content, mimeType };
  }
  return { type: "text", text: content };
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
      <ContentViewer block={toContentBlock(content, mimeType)} copyable />
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
            <AnnotationBadge
              facet="audience"
              value={
                annotations.audience.split(", ") as ("user" | "assistant")[]
              }
            />
          )}
          {annotations?.priority !== undefined && (
            <AnnotationBadge facet="priority" value={annotations.priority} />
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
