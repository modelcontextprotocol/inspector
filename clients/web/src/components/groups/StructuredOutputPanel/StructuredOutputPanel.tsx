import { useState } from "react";
import {
  Collapse,
  Group,
  Paper,
  ScrollArea,
  Stack,
  Title,
} from "@mantine/core";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { ContentViewer } from "../../elements/ContentViewer/ContentViewer";
import { ExpandToggle } from "../../elements/ExpandToggle/ExpandToggle";

export interface StructuredOutputPanelProps {
  /** The result's `structuredContent` — the tool's schema-validated payload. */
  structuredContent: NonNullable<CallToolResult["structuredContent"]>;
  /** Whether the section starts expanded. Defaults to `true`. */
  defaultExpanded?: boolean;
}

// Bordered box matching the "Resource Links" group in the result panel, so the
// two supplementary sections of a tool result read as siblings.
const StructuredBox = Paper.withProps({
  withBorder: true,
  radius: "md",
  p: "md",
  variant: "panel",
});

const StructuredInner = Stack.withProps({
  gap: "sm",
});

const HeaderRow = Group.withProps({
  justify: "space-between",
  wrap: "nowrap",
});

// h4 (size h5) for the same reason as the "Resource Links" heading: the panel's
// "Results" title is h3, so a sub-box heading is h4 and the heading order never
// skips a level (axe `heading-order`).
const StructuredHeader = Title.withProps({
  order: 4,
  size: "h5",
});

// Caps the payload so a large structured result scrolls within the box instead
// of pushing the content blocks out of view. `Autosize` sizes to the content up
// to `mah`, so a small object still takes only what it needs.
const StructuredScroll = ScrollArea.Autosize.withProps({
  mah: 400,
  type: "auto",
  scrollbars: "y",
  offsetScrollbars: true,
});

/**
 * Collapsible "Structured Output" section for a tool result's
 * `structuredContent` (#1908). A tool declaring an `outputSchema` returns its
 * real payload here — the `content[]` blocks usually only summarize it — so v1
 * rendered it as its own inspectable JSON section. Without this, the payload is
 * dropped from the Tools screen entirely, with no hint it was ever returned.
 *
 * The JSON is pretty-printed and syntax-highlighted through {@link ContentViewer}
 * (an `application/json` text block), so it is copyable and scannable field by
 * field.
 */
export function StructuredOutputPanel({
  structuredContent,
  defaultExpanded = true,
}: StructuredOutputPanelProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    // `data-testid` so the headless tab smoke (#2148) can assert this section
    // rendered without matching on its heading copy. A `data-*` attribute is
    // not part of a component's typed props, so it is passed at the call site.
    <StructuredBox data-testid="structured-output">
      <StructuredInner>
        <HeaderRow>
          <StructuredHeader>Structured Output</StructuredHeader>
          <ExpandToggle
            expanded={expanded}
            onToggle={() => setExpanded((value) => !value)}
            ariaLabel={`${expanded ? "Collapse" : "Expand"} structured output`}
          />
        </HeaderRow>
        {/* Content stays mounted across a collapse (Mantine `Collapse`), so the
            highlighted JSON isn't re-rendered from scratch on every toggle. */}
        <Collapse in={expanded}>
          <StructuredScroll>
            <ContentViewer
              block={{
                type: "text",
                text: JSON.stringify(structuredContent, null, 2),
              }}
              mimeType="application/json"
              copyable
            />
          </StructuredScroll>
        </Collapse>
      </StructuredInner>
    </StructuredBox>
  );
}
