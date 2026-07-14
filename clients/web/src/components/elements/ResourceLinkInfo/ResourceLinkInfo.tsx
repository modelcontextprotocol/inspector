import type { ReactNode } from "react";
import { Badge, Group, Stack, Text } from "@mantine/core";

export interface ResourceLinkInfoProps {
  /** The linked resource's URI (always shown). */
  uri: string;
  /** Optional human-friendly name shown beneath the URI. */
  name?: string;
  /** Optional MIME type shown as a badge. */
  mimeType?: string;
  /**
   * Optional trailing element placed at the end of the URI row — e.g. an
   * expand/collapse indicator supplied by an interactive wrapper.
   */
  action?: ReactNode;
}

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

/**
 * Pure-display metadata for a `resource_link`: the URI (monospace, link-styled),
 * an optional name, and a MIME-type badge. The optional `action` slot lets an
 * interactive wrapper (e.g. {@link ResourceLink}) place an expand/collapse
 * indicator in the URI row.
 */
export function ResourceLinkInfo({
  uri,
  name,
  mimeType,
  action,
}: ResourceLinkInfoProps) {
  return (
    <HeaderStack>
      <UriRow>
        <UriText>{uri}</UriText>
        <MetaGroup>
          {mimeType && <MimeBadge>{mimeType}</MimeBadge>}
          {action}
        </MetaGroup>
      </UriRow>
      {name && <NameText>{name}</NameText>}
    </HeaderStack>
  );
}
