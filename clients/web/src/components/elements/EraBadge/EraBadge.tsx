import { Badge } from "@mantine/core";
import type { ProtocolEra } from "@modelcontextprotocol/client";
import { formatEra, isModernEra } from "./eraUtils";

export interface EraBadgeProps {
  /** The negotiated protocol era; `undefined` renders as Legacy. */
  era: ProtocolEra | undefined;
}

// Labels a connection's negotiated protocol era (SEP §7.8). Feed it from
// connection state only — see the note in `eraUtils` on why the era must never
// be inferred from individual message frames.
export function EraBadge({ era }: EraBadgeProps) {
  return (
    <Badge variant="outline" color={isModernEra(era) ? "blue" : "gray"}>
      {formatEra(era)}
    </Badge>
  );
}
