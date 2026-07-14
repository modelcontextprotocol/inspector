import type { ReactNode } from "react";
import { Badge, Group, Stack, Text } from "@mantine/core";
import { CopyButton } from "../CopyButton/CopyButton";

export interface ResourceLinkInfoProps {
  /** The linked resource's URI (always shown, with a copy button). */
  uri: string;
  /** Optional human-friendly name shown above the URI. */
  name?: string;
  /** Optional MIME type shown as a badge. */
  mimeType?: string;
  /**
   * Optional trailing element placed at the end of the header row (beside the
   * MIME badge) — e.g. an expand/collapse control supplied by an interactive
   * wrapper.
   */
  action?: ReactNode;
}

const HeaderStack = Stack.withProps({
  gap: 4,
});

// Name + meta (MIME badge, action). `justify` is set per-instance: spread when
// a name is present, otherwise the meta hugs the right.
const HeaderRow = Group.withProps({
  wrap: "nowrap",
  gap: "xs",
  align: "flex-start",
});

// Copy control + the URI, on the line below the name.
const UriRow = Group.withProps({
  wrap: "nowrap",
  gap: "xs",
  align: "center",
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
  flex: 1,
  miw: 0,
});

/**
 * Pure-display metadata for a `resource_link`: an optional name and MIME-type
 * badge on the header row, then the URI (monospace, link-styled) on the line
 * below with a copy button. The optional `action` slot lets an interactive
 * wrapper (e.g. {@link ResourceLink}) place an expand/collapse control beside
 * the MIME badge.
 */
export function ResourceLinkInfo({
  uri,
  name,
  mimeType,
  action,
}: ResourceLinkInfoProps) {
  const hasHeader = Boolean(name || mimeType || action);
  return (
    <HeaderStack>
      {hasHeader && (
        <HeaderRow justify={name ? "space-between" : "flex-end"}>
          {name && <NameText>{name}</NameText>}
          <MetaGroup>
            {mimeType && <MimeBadge>{mimeType}</MimeBadge>}
            {action}
          </MetaGroup>
        </HeaderRow>
      )}
      <UriRow>
        <CopyButton value={uri} />
        <UriText>{uri}</UriText>
      </UriRow>
    </HeaderStack>
  );
}
