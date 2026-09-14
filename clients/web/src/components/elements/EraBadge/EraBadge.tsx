import { Badge } from "@mantine/core";
import type { ProtocolEra } from "@modelcontextprotocol/client";
import { formatEra, isModernEra } from "./eraUtils";

export interface EraBadgeProps {
  /** The negotiated protocol era; `undefined` renders as Legacy. */
  era: ProtocolEra | undefined;
  /**
   * Font weight override. The app-wide `ThemeBadge` defaults to `fw: 600`,
   * which is right where this badge is a standalone chip (ProtocolListPanel's
   * header). Connection Info renders it as the *value* half of a label/value
   * row, where the convention is bold label / normal value, so it passes 400.
   * Left undefined the theme default applies (#2328).
   */
  fw?: number;
}

// Labels a connection's negotiated protocol era (SEP §7.8). Feed it from
// connection state only — see the note in `eraUtils` on why the era must never
// be inferred from individual message frames.
export function EraBadge({ era, fw }: EraBadgeProps) {
  return (
    <Badge variant="outline" color={isModernEra(era) ? "blue" : "gray"} fw={fw}>
      {formatEra(era)}
    </Badge>
  );
}
