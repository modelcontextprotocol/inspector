import {
  Alert,
  CloseButton,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import type {
  CallToolResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import { ContentViewer } from "../../elements/ContentViewer/ContentViewer";
import { ResourceLink } from "../ResourceLink/ResourceLink";

export interface ToolResultPanelProps {
  result: CallToolResult;
  /**
   * Dismiss the result and return to the input form (#1661). Mirrors the
   * Prompts screen: the result replaces the form while present, and the
   * top-left X flips back to the form so the tool can be re-run.
   */
  onClear: () => void;
  /**
   * Read-on-demand handler so `resource_link` blocks in the result can fetch
   * and inline their contents.
   */
  onReadResource?: (uri: string) => Promise<ReadResourceResult>;
}

type ContentBlock = CallToolResult["content"][number];
type ResourceLinkBlock = Extract<ContentBlock, { type: "resource_link" }>;

// A result's content is rendered as a run of segments in original order: each
// non-link block on its own, and every maximal run of consecutive
// `resource_link` blocks collapsed into one grouped "Resource Links" box.
type ResultSegment =
  | { kind: "links"; links: { block: ResourceLinkBlock; index: number }[] }
  | { kind: "block"; block: ContentBlock; index: number };

// Walk the content array once, coalescing adjacent `resource_link` blocks into a
// single `links` segment so a run of links renders inside one scrollable box
// while preserving the overall block order.
function segmentContent(content: ContentBlock[]): ResultSegment[] {
  const segments: ResultSegment[] = [];
  content.forEach((block, index) => {
    if (block.type === "resource_link") {
      const last = segments[segments.length - 1];
      if (last && last.kind === "links") {
        last.links.push({ block, index });
      } else {
        segments.push({ kind: "links", links: [{ block, index }] });
      }
    } else {
      segments.push({ kind: "block", block, index });
    }
  });
  return segments;
}

// Outer column: the header pins (`flex: 0 0 auto`) and the scroll region
// absorbs overflow when the enclosing card hits its `mah`. `mih: 0` lets the
// flex children shrink below their content's intrinsic height.
const PanelStack = Stack.withProps({
  gap: "md",
  miw: 0,
  mih: 0,
});

const HeaderRow = Group.withProps({
  justify: "space-between",
  flex: "0 0 auto",
});

// Close button + title, mirroring PromptMessagesDisplay so the two result
// panels dismiss the same way.
const HeaderLeft = Group.withProps({
  gap: "xs",
  wrap: "nowrap",
});

// `0 1 auto` + `mih: 0` lets the scroll region shrink (never grow) so a short
// result doesn't reserve height while a long one scrolls within the card cap.
const ResultScroll = ScrollArea.withProps({
  flex: "0 1 auto",
  miw: 0,
  mih: 0,
  type: "auto",
  scrollbars: "y",
  offsetScrollbars: true,
});

const ResultStack = Stack.withProps({
  gap: "md",
});

// Grouped container for a run of `resource_link` blocks — a bordered box with a
// "Resource Links" heading and its own bounded scroll region, mirroring the
// "Messages" box in the Protocol monitoring sidebar (ProtocolListPanel).
const ResourceLinksBox = Paper.withProps({
  withBorder: true,
  radius: "md",
  p: "md",
});

const ResourceLinksInner = Stack.withProps({
  gap: "sm",
});

const ResourceLinksHeader = Title.withProps({
  // The panel "Results" title is h3 (size h4); this sub-box heading is h4 so the
  // heading order doesn't skip a level (axe `heading-order`).
  order: 4,
  size: "h5",
});

// Caps the grouped links so a long list scrolls within the box instead of
// pushing the rest of the result down — mirrors the bounded Messages list.
const ResourceLinksScroll = ScrollArea.Autosize.withProps({
  mah: 360,
  type: "auto",
  scrollbars: "y",
  offsetScrollbars: true,
});

const ResourceLinksStack = Stack.withProps({
  gap: "sm",
});

export function ToolResultPanel({
  result,
  onClear,
  onReadResource,
}: ToolResultPanelProps) {
  return (
    <PanelStack>
      <HeaderRow>
        <HeaderLeft>
          <CloseButton aria-label="Close results" onClick={onClear} />
          {/* h3 (not h4), size h4: request modals open over the Tools screen
              with an `h2` `Modal.Title`, so an `h4` here would skip a level
              (axe `heading-order`); `size="h4"` preserves the visual size. */}
          <Title order={3} size="h4">
            Results
          </Title>
        </HeaderLeft>
      </HeaderRow>
      <ResultScroll>
        <ResultStack>
          {result.isError ? (
            <Alert color="red" variant="light" title="Tool Error">
              {result.content
                .filter((b) => b.type === "text")
                .map((b) => b.text)
                .join("\n")}
            </Alert>
          ) : result.content.length === 0 ? (
            <Text c="dimmed">No results yet</Text>
          ) : (
            segmentContent(result.content).map((segment) =>
              segment.kind === "links" ? (
                <ResourceLinksBox key={`links-${segment.links[0].index}`}>
                  <ResourceLinksInner>
                    <ResourceLinksHeader>Resource Links</ResourceLinksHeader>
                    <ResourceLinksScroll>
                      <ResourceLinksStack>
                        {segment.links.map(({ block, index }) => (
                          <ResourceLink
                            key={index}
                            uri={block.uri}
                            name={block.name}
                            mimeType={block.mimeType}
                            onReadResource={onReadResource}
                          />
                        ))}
                      </ResourceLinksStack>
                    </ResourceLinksScroll>
                  </ResourceLinksInner>
                </ResourceLinksBox>
              ) : (
                <ContentViewer
                  key={segment.index}
                  block={segment.block}
                  copyable={segment.block.type === "text"}
                />
              ),
            )
          )}
        </ResultStack>
      </ResultScroll>
    </PanelStack>
  );
}
