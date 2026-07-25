import { Badge } from "@mantine/core";
import type { ServerType } from "@inspector/core/mcp/types.js";

export interface TransportBadgeProps {
  transport: ServerType;
}

const transportLabel: Record<ServerType, string> = {
  stdio: "STDIO",
  sse: "HTTP",
  "streamable-http": "HTTP",
};

const OutlineBadge = Badge.withProps({
  variant: "outline",
  color: "gray",
});

export function TransportBadge({ transport }: TransportBadgeProps) {
  return <OutlineBadge>{transportLabel[transport]}</OutlineBadge>;
}
