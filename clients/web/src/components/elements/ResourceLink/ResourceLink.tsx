import { useState } from "react";
import {
  Alert,
  Badge,
  Group,
  Loader,
  Paper,
  ScrollArea,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { RiArrowDownSLine, RiArrowRightSLine } from "react-icons/ri";
import { ContentViewer } from "../ContentViewer/ContentViewer";

export interface ResourceLinkProps {
  /** The linked resource's URI (always shown). */
  uri: string;
  /** Optional human-friendly name shown beneath the URI. */
  name?: string;
  /** Optional description shown beneath the name. */
  description?: string;
  /** Optional MIME type shown as a badge. */
  mimeType?: string;
  /**
   * Read-on-demand handler. When provided, the card becomes expandable: the
   * first expand calls this with the link's `uri` and renders the returned
   * read result inline. Omit to render a static, non-expandable card.
   */
  onReadResource?: (uri: string) => Promise<ReadResourceResult>;
}

const LinkCard = Paper.withProps({
  withBorder: true,
  p: "sm",
  radius: "md",
});

const HeaderButton = UnstyledButton.withProps({
  w: "100%",
  ta: "left",
});

const HeaderStack = Stack.withProps({
  gap: 4,
});

const UriRow = Group.withProps({
  justify: "space-between",
  wrap: "nowrap",
  gap: "xs",
  align: "flex-start",
});

const UriText = Text.withProps({
  size: "sm",
  c: "blue",
  ff: "monospace",
  variant: "monoBreak",
  flex: 1,
  miw: 0,
});

const MetaGroup = Group.withProps({
  gap: "xs",
  wrap: "nowrap",
});

const MimeBadge = Badge.withProps({
  size: "sm",
  variant: "light",
  color: "blue",
  // MIME types are conventionally lowercase; keep them as-is rather than
  // letting Badge's default uppercase transform mangle them.
  tt: "none",
});

const NameText = Text.withProps({
  size: "sm",
  fw: 600,
});

const DescriptionText = Text.withProps({
  size: "sm",
  c: "dimmed",
});

const ExpandedSection = Stack.withProps({
  gap: "xs",
  mt: "xs",
});

// Caps the inline read result so a large resource scrolls within the card
// instead of pushing the page down — mirrors V1's bounded resource view.
const ResultScroll = ScrollArea.withProps({
  mah: 400,
  type: "auto",
  scrollbars: "y",
  offsetScrollbars: true,
});

const ResourceLabel = Text.withProps({
  size: "sm",
  fw: 600,
  c: "green",
});

const LoadingText = Text.withProps({
  size: "sm",
  c: "dimmed",
});

/**
 * Expandable card for a `resource_link` content block. Shows the URI, optional
 * name / description / MIME badge, and — when `onReadResource` is supplied —
 * an expand affordance that reads the linked resource on demand and renders the
 * full read result inline as formatted JSON (via {@link ContentViewer}). The
 * fetched result is cached so collapsing and re-expanding does not re-read.
 */
export function ResourceLink({
  uri,
  name,
  description,
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
    // Already fetched (or previously errored) — just re-reveal the cache.
    if (result !== null || error !== null) return;
    setLoading(true);
    try {
      setResult(await onReadResource(uri));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const Chevron = expanded ? RiArrowDownSLine : RiArrowRightSLine;

  const header = (
    <HeaderStack>
      <UriRow>
        <UriText>{uri}</UriText>
        <MetaGroup>
          {mimeType && <MimeBadge>{mimeType}</MimeBadge>}
          {expandable &&
            (loading ? (
              <Loader size="xs" />
            ) : (
              <Chevron size={16} aria-hidden />
            ))}
        </MetaGroup>
      </UriRow>
      {name && <NameText>{name}</NameText>}
      {description && <DescriptionText>{description}</DescriptionText>}
    </HeaderStack>
  );

  return (
    <LinkCard>
      {expandable ? (
        <HeaderButton
          onClick={() => void toggle()}
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} resource ${uri}`}
        >
          {header}
        </HeaderButton>
      ) : (
        header
      )}
      {expanded && (
        <ExpandedSection>
          {loading ? (
            <LoadingText>Loading resource…</LoadingText>
          ) : error !== null ? (
            <Alert color="red" variant="light" title="Failed to read resource">
              {error}
            </Alert>
          ) : result !== null ? (
            <>
              <ResourceLabel>Resource:</ResourceLabel>
              <ResultScroll>
                <ContentViewer
                  block={{
                    type: "text",
                    text: JSON.stringify(result, null, 2),
                  }}
                  copyable
                />
              </ResultScroll>
            </>
          ) : null}
        </ExpandedSection>
      )}
    </LinkCard>
  );
}
