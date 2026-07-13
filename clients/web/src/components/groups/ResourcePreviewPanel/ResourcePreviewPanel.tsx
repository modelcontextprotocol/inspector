import {
  Button,
  CloseButton,
  Flex,
  Group,
  ScrollArea,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { useState } from "react";
import type {
  BlobResourceContents,
  Resource,
  TextResourceContents,
} from "@modelcontextprotocol/sdk/types.js";
import { accessibleTextColor } from "../../elements/accessibleTextColor";
import { AnnotationBadge } from "../../elements/AnnotationBadge/AnnotationBadge";
import { ContentViewer } from "../../elements/ContentViewer/ContentViewer";
import { getMimeKind } from "../../elements/ContentViewer/contentViewerUtils";
import { CopyButton } from "../../elements/CopyButton/CopyButton";
import { SubscribeButton } from "../../elements/SubscribeButton/SubscribeButton";

export interface ResourcePreviewPanelProps {
  resource: Resource;
  contents: (TextResourceContents | BlobResourceContents)[];
  lastUpdated?: Date;
  isSubscribed: boolean;
  /**
   * Whether the connected server advertises the `resources.subscribe`
   * capability. When false, the Subscribe/Unsubscribe button is hidden.
   * Defaults to true so the button renders unless explicitly unsupported.
   */
  subscriptionsSupported?: boolean;
  onRefresh: () => void;
  onSubscribe: () => void;
  onUnsubscribe: () => void;
  /**
   * When provided, a top-left X button dismisses the panel. The host
   * (`ResourcesScreen`) decides what to show in its place — either the
   * originating template form or the empty state.
   */
  onClose?: () => void;
}

function formatLastUpdated(date: Date): string {
  return `Last updated: ${date.toLocaleString()}`;
}

// MIME kinds whose rendered preview (react-markdown, the CSV table, the
// sandboxed HTML iframe) hides the underlying text. For these the panel offers
// a "View Source" toggle that swaps the renderer for the raw resource text.
const SOURCE_TOGGLEABLE_KINDS = new Set(["markdown", "csv", "html"]);

// MIME forced on ContentViewer in source mode so it routes through the plain
// preformatted-text renderer regardless of the resource's real type.
const SOURCE_MIME = "text/plain";

function isSourceToggleable(mimeType: string): boolean {
  return SOURCE_TOGGLEABLE_KINDS.has(getMimeKind(mimeType));
}

const HeaderRow = Group.withProps({
  justify: "space-between",
  wrap: "nowrap",
  flex: "0 0 auto",
});

const HeaderLeft = Group.withProps({
  gap: "xs",
  wrap: "nowrap",
});

const UriGroup = Group.withProps({
  gap: "xs",
  wrap: "nowrap",
});

const UriText = Text.withProps({
  size: "sm",
  // Scheme-aware readable blue: `c="blue"` renders blue-4 in dark mode, which
  // falls just under WCAG AA (4.38:1) on the card. `-light-color` clears it in
  // both schemes (see `accessibleTextColor`).
  c: accessibleTextColor("blue"),
  truncate: "end",
});

const MetaRow = Group.withProps({
  justify: "space-between",
  wrap: "nowrap",
  flex: "0 0 auto",
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
  flex: "0 0 auto",
});

const AnnotationGroup = Group.withProps({
  gap: "xs",
});

const ActionGroup = Group.withProps({
  gap: "xs",
});

// Subtle footer action button. Shared by Refresh and the View Source toggle so
// the two stay visually identical (the toggle is deliberately styled to match
// Refresh, which sits immediately to its right).
const FooterButton = Button.withProps({
  variant: "subtle",
  size: "sm",
});

const Spacer = Flex.withProps({});

// The panel sizes to its content: when the resource body is short the
// Card hugs it; when the body would overflow the Card's `mah`, the
// browser shrinks shrinkable flex items (only ContentScroll, since the
// header / meta / footer rows opt out with `flex: 0 0 auto`) and the
// inner ScrollArea takes over scrolling — keeping the subscribe button
// pinned at the bottom edge of the cap.
const PanelStack = Stack.withProps({
  gap: "md",
  miw: 0,
  mih: 0,
});

// Middle scroll region: basis sized to its own content, can shrink to
// fit the available space when content overflows, never grows past its
// content (so a short resource body doesn't push the footer down).
const ContentScroll = ScrollArea.withProps({
  flex: "0 1 auto",
  miw: 0,
  mih: 0,
  type: "auto",
  scrollbars: "y",
  offsetScrollbars: true,
});

const ContentStack = Stack.withProps({
  gap: "md",
});

// Map a file extension to the MIME type that drives ContentViewer's per-MIME
// renderer dispatch. MCP servers commonly omit `mimeType` (or return a generic
// `text/plain` / `application/octet-stream`), so the URI suffix is the most
// reliable signal for engaging the markdown / PDF / CSV / XML / HTML / CSS
// renderers. Order doesn't matter — suffixes are unique.
const URI_SUFFIX_MIME: ReadonlyArray<readonly [string, string]> = [
  [".md", "text/markdown"],
  [".markdown", "text/markdown"],
  [".csv", "text/csv"],
  [".json", "application/json"],
  [".xml", "application/xml"],
  [".html", "text/html"],
  [".htm", "text/html"],
  [".css", "text/css"],
  [".pdf", "application/pdf"],
];

// Infer a MIME type from the URI's file extension when the server didn't supply
// one. Returns undefined for unrecognized suffixes so callers fall through to
// the octet-stream default.
function inferMimeFromUri(uri: string): string | undefined {
  const path = uri.split("?")[0].split("#")[0];
  const lower = path.toLowerCase();
  for (const [suffix, mime] of URI_SUFFIX_MIME) {
    if (lower.endsWith(suffix)) return mime;
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
  subscriptionsSupported = true,
  onRefresh,
  onSubscribe,
  onUnsubscribe,
  onClose,
}: ResourcePreviewPanelProps) {
  const { uri, annotations } = resource;
  const mimeType = effectiveMime(contents[0]?.mimeType, resource);

  const [showSource, setShowSource] = useState(false);
  // Reset to the rendered view when the previewed resource changes (the panel
  // is reused, not remounted, across resources). React's documented
  // "adjust state during render" pattern — no effect, so no cascading render.
  const [prevUri, setPrevUri] = useState(uri);
  if (uri !== prevUri) {
    setPrevUri(uri);
    setShowSource(false);
  }
  const sourceToggleable = isSourceToggleable(mimeType);

  return (
    <PanelStack>
      <HeaderRow>
        <HeaderLeft>
          {onClose && (
            <CloseButton aria-label="Close preview" onClick={onClose} />
          )}
          <Title order={4}>Resource</Title>
        </HeaderLeft>
        <UriGroup>
          <UriText>{uri}</UriText>
          <CopyButton value={uri} />
        </UriGroup>
      </HeaderRow>
      <ContentScroll>
        <ContentStack>
          {contents.map((item, index) => {
            const itemMime = effectiveMime(item.mimeType, resource);
            // The toggle is gated on the first content item but applies per
            // item: in source mode only the source-toggleable items (the ones
            // whose rendered view hides their text) switch to plain text, so a
            // mixed multi-part resource doesn't force an image/PDF blob through
            // the text decoder.
            const renderMime =
              showSource && isSourceToggleable(itemMime)
                ? SOURCE_MIME
                : itemMime;
            return (
              <ContentViewer
                key={index}
                contents={item}
                mimeType={renderMime}
                copyable
              />
            );
          })}
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
          {sourceToggleable && (
            <FooterButton
              aria-pressed={showSource}
              onClick={() => setShowSource((shown) => !shown)}
            >
              {showSource ? "View Rendered" : "View Source"}
            </FooterButton>
          )}
          <FooterButton onClick={onRefresh}>Refresh</FooterButton>
          {subscriptionsSupported && (
            <SubscribeButton
              subscribed={isSubscribed}
              onToggle={isSubscribed ? onUnsubscribe : onSubscribe}
            />
          )}
        </ActionGroup>
      </FooterRow>
    </PanelStack>
  );
}
