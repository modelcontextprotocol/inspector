import {
  Button,
  Flex,
  Group,
  ScrollArea,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import type {
  BlobResourceContents,
  ContentBlock,
  Resource,
  TextResourceContents,
} from "@modelcontextprotocol/sdk/types.js";
import { AnnotationBadge } from "../../elements/AnnotationBadge/AnnotationBadge";
import { ContentViewer } from "../../elements/ContentViewer/ContentViewer";
import { CopyButton } from "../../elements/CopyButton/CopyButton";
import { SubscribeButton } from "../../elements/SubscribeButton/SubscribeButton";

export interface ResourcePreviewPanelProps {
  resource: Resource;
  contents: (TextResourceContents | BlobResourceContents)[];
  lastUpdated?: Date;
  isSubscribed: boolean;
  onRefresh: () => void;
  onSubscribe: () => void;
  onUnsubscribe: () => void;
}

function toContentBlock(
  item: TextResourceContents | BlobResourceContents,
): ContentBlock {
  if ("text" in item) {
    return { type: "text", text: item.text };
  }
  const mimeType = item.mimeType ?? "application/octet-stream";
  if (mimeType.startsWith("image/")) {
    return { type: "image", data: item.blob, mimeType };
  }
  if (mimeType.startsWith("audio/")) {
    return { type: "audio", data: item.blob, mimeType };
  }
  return {
    type: "text",
    text: `[Binary content (${mimeType}) — preview not supported]`,
  };
}

function formatLastUpdated(date: Date): string {
  return `Last updated: ${date.toLocaleString()}`;
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

// Outer container fills the parent (a fixed-height Card in the resource
// branch of ResourcesScreen) so the header/footer can pin to its edges
// while the content area scrolls.
const PanelStack = Stack.withProps({
  gap: "md",
  h: "100%",
  flex: 1,
  miw: 0,
});

// The middle scroll region. flex=1 lets it absorb the height left over
// after the header / meta / footer rows; miw=0 prevents wide markdown
// (tables, long links) from pushing the panel past the viewport.
const ContentScroll = ScrollArea.withProps({
  flex: 1,
  miw: 0,
  type: "auto",
  scrollbars: "y",
  offsetScrollbars: true,
});

const ContentStack = Stack.withProps({
  gap: "md",
});

// Infer a markdown MIME from the URI when the server didn't supply one.
// MCP servers often return `text/plain` (or omit mimeType entirely) for
// `.md` resources; the file extension is the most reliable fallback signal.
function inferMimeFromUri(uri: string): string | undefined {
  const path = uri.split("?")[0].split("#")[0];
  const lower = path.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) {
    return "text/markdown";
  }
  return undefined;
}

function effectiveMime(
  itemMime: string | undefined,
  resource: Resource,
): string {
  return (
    itemMime ??
    resource.mimeType ??
    inferMimeFromUri(resource.uri) ??
    "application/octet-stream"
  );
}

export function ResourcePreviewPanel({
  resource,
  contents,
  lastUpdated,
  isSubscribed,
  onRefresh,
  onSubscribe,
  onUnsubscribe,
}: ResourcePreviewPanelProps) {
  const { uri, annotations } = resource;
  const mimeType = effectiveMime(contents[0]?.mimeType, resource);

  return (
    <PanelStack>
      <HeaderRow>
        <Title order={4}>Resource</Title>
        <UriGroup>
          <UriText>{uri}</UriText>
          <CopyButton value={uri} />
        </UriGroup>
      </HeaderRow>
      <ContentScroll>
        <ContentStack>
          {contents.map((item, index) => (
            <ContentViewer
              key={index}
              block={toContentBlock(item)}
              mimeType={effectiveMime(item.mimeType, resource)}
              copyable
            />
          ))}
        </ContentStack>
      </ContentScroll>
      <MetaRow>
        {lastUpdated ? (
          <TimestampText>{formatLastUpdated(lastUpdated)}</TimestampText>
        ) : (
          <Spacer />
        )}
        {contents.length <= 1 && <MimeText>{mimeType}</MimeText>}
      </MetaRow>
      <FooterRow>
        <AnnotationGroup>
          {annotations?.audience && (
            <AnnotationBadge facet="audience" value={annotations.audience} />
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
    </PanelStack>
  );
}
