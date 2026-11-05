import { useState } from "react";
import {
  Alert,
  CloseButton,
  Collapse,
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
} from "@modelcontextprotocol/client";
import { ContentViewer } from "../../elements/ContentViewer/ContentViewer";
import { ExpandToggle } from "../../elements/ExpandToggle/ExpandToggle";
import { formatDuration } from "../../../utils/toolRunHistory";
import { ResourceLink } from "../ResourceLink/ResourceLink";
import { StructuredOutputPanel } from "../StructuredOutputPanel/StructuredOutputPanel";
import { resultHasResourceLinks } from "./toolResultUtils";

export interface ToolResultPanelProps {
  result: CallToolResult;
  /**
   * Dismiss the result (#1661). The input form stays beside it (#2830), so
   * this only clears the result panel; the run stays in the tool's history.
   */
  onClear: () => void;
  /**
   * Read-on-demand handler so `resource_link` blocks in the result can fetch
   * and inline their contents.
   */
  onReadResource?: (uri: string) => Promise<ReadResourceResult>;
  /** How long the call took, shown beside the title when known (#2830). */
  durationMs?: number;
  /**
   * The arguments the call was sent with, shown in a collapsed section when
   * known (#2830) — the form beside the result may since have been edited.
   */
  args?: Record<string, unknown>;
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

// Every scroll region in this panel (`ResultScroll`, `NonLinkCap`) already
// scrolls a JSON block whole, so the block's Ace editor must grow to its full
// height rather than stop at `ContentViewer`'s default row cap and scroll
// inside — which is what put two vertical scrollbars side by side on a long
// result (#2525). Lifting the cap is affordable here because the panel shows
// one result at a time; the cap exists for the Protocol and Network lists,
// which keep every payload mounted.
const UNCAPPED_JSON_LINES = Infinity;

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
  // The panel "Results" title is h2 (size h4); this sub-box heading is h3 so the
  // heading order doesn't skip a level (axe `heading-order`).
  order: 3,
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

// h2, size h4: a panel heading under the page's visually hidden h1 (#2827),
// which also keeps request modals' `h2` `Modal.Title` from being skipped to
// (axe `heading-order`); `size="h4"` preserves the visual size.
const ResultsTitle = Title.withProps({
  order: 2,
  size: "h4",
});

const DurationText = Text.withProps({
  size: "sm",
  c: "dimmed",
});

// The "Arguments" box pins above the result body (`flex: 0 0 auto`) and caps
// its own height, so expanding a long argument object can't push the result
// out of the card.
const ArgumentsBox = Paper.withProps({
  withBorder: true,
  radius: "md",
  p: "sm",
  variant: "panel",
  flex: "0 0 auto",
});

const ArgumentsHeaderRow = Group.withProps({
  justify: "space-between",
  wrap: "nowrap",
});

const ArgumentsHeader = Title.withProps({
  order: 3,
  size: "h5",
});

const ArgumentsScroll = ScrollArea.Autosize.withProps({
  mah: 200,
  type: "auto",
  scrollbars: "y",
  offsetScrollbars: true,
});

const ErrorAlert = Alert.withProps({
  color: "red",
  variant: "light",
  title: "Tool Error",
});

// A completed call whose result renders nothing. `content: []` with no
// `structuredContent` is a legal CallToolResult, and this panel is only mounted
// once a result exists — so saying "no results yet" here would deny a call the
// user just watched succeed (#1860). Name the outcome instead.
const EmptyResultAlert = Alert.withProps({
  color: "gray",
  variant: "light",
  title: "Empty result",
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

// Collapsed by default: the form beside the result usually still shows the
// same values, so this is for the case where it no longer does.
function CallArguments({ args }: { args: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <ArgumentsBox>
      <ArgumentsHeaderRow>
        <ArgumentsHeader>Arguments</ArgumentsHeader>
        <ExpandToggle
          expanded={expanded}
          onToggle={() => setExpanded((value) => !value)}
          ariaLabel={`${expanded ? "Collapse" : "Expand"} arguments`}
        />
      </ArgumentsHeaderRow>
      <Collapse in={expanded}>
        <ArgumentsScroll>
          <ContentViewer
            block={{ type: "text", text: JSON.stringify(args, null, 2) }}
            mimeType="application/json"
            copyable
          />
        </ArgumentsScroll>
      </Collapse>
    </ArgumentsBox>
  );
}

export function ToolResultPanel({
  result,
  onClear,
  onReadResource,
  durationMs,
  args,
}: ToolResultPanelProps) {
  const segments =
    result.isError || result.content.length === 0
      ? []
      : segmentContent(result.content);
  // Results with a Resource Links box fill the card so the box grows to the
  // available height (and scrolls inside). Plain text/image results keep the
  // scroll-within-card body so a short result doesn't reserve empty height.
  const hasLinks = resultHasResourceLinks(result);
  // A tool with an `outputSchema` returns its real payload in
  // `structuredContent`, which the `content[]` blocks typically only summarize
  // (#1908). Render it as its own section — including alongside an error or an
  // empty `content` array, so it is never silently dropped.
  const structuredNode = result.structuredContent ? (
    <StructuredOutputPanel
      key="structured-output"
      structuredContent={result.structuredContent}
    />
  ) : null;

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
        jsonMaxLines={UNCAPPED_JSON_LINES}
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
          <ResultsTitle>Results</ResultsTitle>
        </HeaderLeft>
        {durationMs !== undefined && (
          <DurationText>{formatDuration(durationMs)}</DurationText>
        )}
      </HeaderRow>
      {args && <CallArguments args={args} />}
      {result.isError ? (
        <ResultScroll>
          <ResultStack>
            <ErrorAlert>
              {result.content
                .filter((b) => b.type === "text")
                .map((b) => b.text)
                .join("\n")}
            </ErrorAlert>
            {structuredNode}
          </ResultStack>
        </ResultScroll>
      ) : result.content.length === 0 && !structuredNode ? (
        <ResultScroll>
          <EmptyResultAlert>
            The tool call completed successfully and returned no content.
          </EmptyResultAlert>
        </ResultScroll>
      ) : hasLinks ? (
        <FillStack>
          {segmentNodes}
          {structuredNode}
        </FillStack>
      ) : (
        <ResultScroll>
          <ResultStack>
            {segmentNodes}
            {structuredNode}
          </ResultStack>
        </ResultScroll>
      )}
    </PanelStack>
  );
}
