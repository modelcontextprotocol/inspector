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
import { resultHasResourceLinks } from "./toolResultUtils";

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

// Outer column fills the (full-height) result card: the header pins
// (`flex: 0 0 auto`) and the body below fills the rest. `mih: 0` lets the flex
// children shrink below their content's intrinsic height.
const PanelStack = Stack.withProps({
  gap: "md",
  miw: 0,
  mih: 0,
  flex: 1,
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

// Body scroll region for non-resource-link results: fills the card and scrolls
// within it when the content is taller than the available space.
const ResultScroll = ScrollArea.withProps({
  flex: 1,
  miw: 0,
  mih: 0,
  type: "auto",
  scrollbars: "y",
  offsetScrollbars: true,
});

const ResultStack = Stack.withProps({
  gap: "md",
});

// A non-link block that shares the card with a "Resource Links" box: capped at
// half the available height and scrollable within, so a long text block can't
// crowd the links box out of view (it keeps the remaining space). `Autosize`
// sizes to content up to the cap, so a short block still takes only what it
// needs. Without links, non-link blocks flow in the main scroll body instead.
const NonLinkCap = ScrollArea.Autosize.withProps({
  mah: "50%",
  flex: "0 1 auto",
  mih: 0,
  type: "auto",
  scrollbars: "y",
  offsetScrollbars: true,
});

// Body column for results that contain a "Resource Links" box: it fills the
// card so the box (which is `flex: 1` within it) can grow to the available
// height and scroll internally, rather than capping at its content height.
const FillStack = Stack.withProps({
  gap: "md",
  flex: 1,
  mih: 0,
});

// Grouped container for a run of `resource_link` blocks — a bordered box with a
// pinned "Resource Links" heading and its own scroll region, mirroring the
// "Messages" box in the Protocol monitoring sidebar (ProtocolListPanel). The
// `panel` variant makes it a flex column (overflow hidden, min-height 0) and
// `flex: 1` lets it grow to fill the result card's available height.
const ResourceLinksBox = Paper.withProps({
  withBorder: true,
  radius: "md",
  p: "md",
  variant: "panel",
  flex: 1,
  mih: 0,
});

const ResourceLinksInner = Stack.withProps({
  gap: "sm",
  flex: 1,
  mih: 0,
});

const ResourceLinksHeader = Title.withProps({
  // The panel "Results" title is h3 (size h4); this sub-box heading is h4 so the
  // heading order doesn't skip a level (axe `heading-order`).
  order: 4,
  size: "h5",
});

// Fills the box below the pinned heading and scrolls the link list within it.
const ResourceLinksScroll = ScrollArea.withProps({
  flex: 1,
  mih: 0,
  type: "auto",
  scrollbars: "y",
  offsetScrollbars: true,
});

const ResourceLinksStack = Stack.withProps({
  gap: "sm",
});

function ResourceLinksGroup({
  links,
  onReadResource,
}: {
  links: { block: ResourceLinkBlock; index: number }[];
  onReadResource?: (uri: string) => Promise<ReadResourceResult>;
}) {
  return (
    <ResourceLinksBox>
      <ResourceLinksInner>
        <ResourceLinksHeader>Resource Links</ResourceLinksHeader>
        <ResourceLinksScroll>
          <ResourceLinksStack>
            {links.map(({ block, index }) => (
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
  );
}

export function ToolResultPanel({
  result,
  onClear,
  onReadResource,
}: ToolResultPanelProps) {
  const segments =
    result.isError || result.content.length === 0
      ? []
      : segmentContent(result.content);
  // Results with a Resource Links box fill the card so the box grows to the
  // available height (and scrolls inside). Plain text/image results keep the
  // scroll-within-card body so a short result doesn't reserve empty height.
  const hasLinks = resultHasResourceLinks(result);

  const segmentNodes = segments.map((segment) => {
    if (segment.kind === "links") {
      return (
        <ResourceLinksGroup
          key={`links-${segment.links[0].index}`}
          links={segment.links}
          onReadResource={onReadResource}
        />
      );
    }
    const viewer = (
      <ContentViewer
        key={segment.index}
        block={segment.block}
        copyable={segment.block.type === "text"}
      />
    );
    // Alongside a Resource Links box, cap the block at half the height (and let
    // it scroll); on its own it flows in the outer scroll body uncapped.
    return hasLinks ? (
      <NonLinkCap key={segment.index}>{viewer}</NonLinkCap>
    ) : (
      viewer
    );
  });

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
      {result.isError ? (
        <ResultScroll>
          <Alert color="red" variant="light" title="Tool Error">
            {result.content
              .filter((b) => b.type === "text")
              .map((b) => b.text)
              .join("\n")}
          </Alert>
        </ResultScroll>
      ) : result.content.length === 0 ? (
        <ResultScroll>
          <Text c="dimmed">No results yet</Text>
        </ResultScroll>
      ) : hasLinks ? (
        <FillStack>{segmentNodes}</FillStack>
      ) : (
        <ResultScroll>
          <ResultStack>{segmentNodes}</ResultStack>
        </ResultScroll>
      )}
    </PanelStack>
  );
}
