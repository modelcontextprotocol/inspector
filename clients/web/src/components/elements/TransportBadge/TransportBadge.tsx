import { Badge } from "@mantine/core";
import type { ServerType } from "@inspector/core/mcp/types.js";

export interface TransportBadgeProps {
  transport: ServerType;
}

const transportLabel: Record<ServerType, string> = {
  stdio: "STDIO",
  sse: "SSE",
  "streamable-http": "HTTP",
};

export function TransportBadge({ transport }: TransportBadgeProps) {
  return (
    <Badge variant="outline" color="gray">
      {transportLabel[transport]}
    </Badge>
  );
}
