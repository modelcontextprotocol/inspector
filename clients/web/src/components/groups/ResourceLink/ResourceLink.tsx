import { useState } from "react";
import { Alert, Card, Collapse, ScrollArea, Stack, Text } from "@mantine/core";
import type { ReadResourceResult } from "@modelcontextprotocol/client";
import { ContentViewer } from "../../elements/ContentViewer/ContentViewer";
import { ExpandToggle } from "../../elements/ExpandToggle/ExpandToggle";
import { ResourceLinkInfo } from "../../elements/ResourceLinkInfo/ResourceLinkInfo";

export interface ResourceLinkProps {
  /** The linked resource's URI (always shown). */
  uri: string;
  /** Optional human-friendly name shown above the URI. */
  name?: string;
  /** Optional MIME type shown as a badge. */
  mimeType?: string;
  /**
   * Read-on-demand handler. When provided, the card becomes expandable: the
   * first expand calls this with the link's `uri` and renders the returned
   * read result inline. Omit to render a static, non-expandable card.
   */
  onReadResource?: (uri: string) => Promise<ReadResourceResult>;
}

// Recessed "inset" surface so each link card reads the same as a Protocol
// message card (ProtocolEntry), matching its colors in both light and dark
// modes; the inset variant also raises nested Code blocks (the expanded read
// result) onto a lighter surface via its cascade variable.
const LinkCard = Card.withProps({
  withBorder: true,
  padding: "sm",
  radius: "md",
  variant: "inset",
});

const ExpandedSection = Stack.withProps({
  gap: "xs",
  mt: "xs",
});

// Caps the inline read result so a large resource scrolls within the card
// instead of pushing the page down — mirrors V1's bounded resource view.
// `Autosize` sizes to the content up to `mah`, then scrolls; a plain
// ScrollArea would need a definite height to scroll, which this card (sized to
// its content) does not provide.
const ResultScroll = ScrollArea.Autosize.withProps({
  mah: 400,
  type: "auto",
  scrollbars: "y",
  offsetScrollbars: true,
});

const LoadingText = Text.withProps({
  size: "sm",
  c: "dimmed",
});

/**
 * Expandable card for a `resource_link` content block. Renders the link's
 * metadata via {@link ResourceLinkInfo} and — when `onReadResource` is supplied
 * — an expand affordance that reads the linked resource on demand and renders
 * the full read result inline as formatted JSON (via {@link ContentViewer}).
 * The fetched result is cached so collapsing and re-expanding does not re-read.
 */
export function ResourceLink({
  uri,
  name,
  mimeType,
  onReadResource,
}: ResourceLinkProps) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ReadResourceResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const expandable = Boolean(onReadResource);

  async function toggle() {
    if (!onReadResource) return;
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    // Only a successful result is cached; re-expanding after an error retries
    // the read so a transient failure isn't permanent.
    if (result !== null) return;
    // Don't fire a second read if one is already in flight (rapid toggle).
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      setResult(await onReadResource(uri));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  // Same tooltip'd expand/collapse control as ProtocolEntry (ExpandToggle),
  // placed in the header row's meta slot as a sibling of the URI's copy button.
  // A per-resource `ariaLabel` keeps the toggles distinguishable to assistive
  // tech when several links are listed (the visible tooltip stays "Expand").
  const action = expandable ? (
    <ExpandToggle
      expanded={expanded}
      onToggle={() => void toggle()}
      ariaLabel={`${expanded ? "Collapse" : "Expand"} resource ${uri}`}
    />
  ) : undefined;

  return (
    <LinkCard>
      <ResourceLinkInfo
        uri={uri}
        name={name}
        mimeType={mimeType}
        action={action}
      />
      {/* Same expand/collapse animation as ProtocolEntry: content stays mounted
          (so the cached read result survives a collapse) and animates via
          Mantine's Collapse. */}
      {expandable && (
        <Collapse in={expanded}>
          <ExpandedSection>
            {loading ? (
              <LoadingText>Loading resource…</LoadingText>
            ) : error !== null ? (
              <Alert
                color="red"
                variant="light"
                title="Failed to read resource"
              >
                {error}
              </Alert>
            ) : result !== null ? (
              <ResultScroll>
                <ContentViewer
                  block={{
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                  }}
                  copyable
                />
              </ResultScroll>
            ) : null}
          </ExpandedSection>
        </Collapse>
      )}
    </LinkCard>
  );
}
