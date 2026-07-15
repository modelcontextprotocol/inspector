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
   * Optional trailing element placed at the end of the URI row (opposite the
   * copy button) — e.g. an expand/collapse control supplied by an interactive
   * wrapper. Mirrors ProtocolEntry, whose toggle sits on the row below the
   * badges.
   */
  action?: ReactNode;
}

const HeaderStack = Stack.withProps({
  gap: 4,
});

// Name (left) + MIME badge (right). `justify` is set per-instance: spread when
// a name is present, otherwise the badge hugs the right.
const HeaderRow = Group.withProps({
  wrap: "nowrap",
  gap: "xs",
  align: "center",
});

// Copy control + URI (left) and the optional expand/collapse control (right),
// on the line below the header — mirroring ProtocolEntry's controls row.
const UriRow = Group.withProps({
  justify: "space-between",
  wrap: "nowrap",
  gap: "xs",
  align: "center",
});

// Copy button + URI cluster; flexes so the URI fills and the action stays right.
const UriCluster = Group.withProps({
  wrap: "nowrap",
  gap: "xs",
  align: "center",
  flex: 1,
  miw: 0,
});

// Match how ProtocolEntry/NetworkEntry render a URL: `sm` / `fw: 500`, in the
// default sans-serif face and text color (not a blue monospace "link"). The
// `monoBreak` variant only adds `word-break: break-all` so a long URI wraps
// within the card instead of overflowing.
const UriText = Text.withProps({
  size: "sm",
  fw: 500,
  variant: "monoBreak",
  flex: 1,
  miw: 0,
});

const MimeBadge = Badge.withProps({
  // Match the point size of the ProtocolEntry method/status badges; the
  // lowercase MIME text reads smaller than their uppercase labels at `sm`.
  size: "md",
  radius: "sm",
  // MIME types are conventionally lowercase; keep them as-is rather than
  // letting Badge's default uppercase transform mangle them.
  tt: "none",
  autoContrast: false,
  // Light mode: the tinted blue-light chip (unchanged). Dark mode: a solid
  // dark-blue fill with white text — matching the solid ProtocolEntry badges
  // rather than a washed-out translucent tint.
  bg: "light-dark(var(--mantine-color-blue-light), var(--mantine-color-blue-9))",
  c: "light-dark(var(--mantine-color-blue-light-color), var(--mantine-color-white))",
});

const NameText = Text.withProps({
  size: "sm",
  fw: 600,
  flex: 1,
  miw: 0,
});

/**
 * Pure-display metadata for a `resource_link`: an optional name and MIME-type
 * badge on the header row, then the URI on the line below with a copy button.
 * The URI is styled like ProtocolEntry/NetworkEntry URLs (`sm` / `fw: 500`,
 * default sans-serif face and color), not a blue monospace link. The optional
 * `action` slot lets an interactive wrapper (e.g. {@link ResourceLink}) place
 * an expand/collapse control at the end of the URI row.
 */
export function ResourceLinkInfo({
  uri,
  name,
  mimeType,
  action,
}: ResourceLinkInfoProps) {
  const hasHeader = Boolean(name || mimeType);
  return (
    <HeaderStack>
      {hasHeader && (
        <HeaderRow justify={name ? "space-between" : "flex-end"}>
          {name && <NameText>{name}</NameText>}
          {mimeType && <MimeBadge>{mimeType}</MimeBadge>}
        </HeaderRow>
      )}
      <UriRow>
        <UriCluster>
          <CopyButton value={uri} />
          <UriText>{uri}</UriText>
        </UriCluster>
        {action}
      </UriRow>
    </HeaderStack>
  );
}
