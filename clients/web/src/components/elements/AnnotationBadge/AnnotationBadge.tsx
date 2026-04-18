import { Badge, useComputedColorScheme } from "@mantine/core";
import type { Role } from "@modelcontextprotocol/sdk/types.js";

export type AnnotationFacet =
  | "audience"
  | "priority"
  | "readOnlyHint"
  | "destructiveHint"
  | "idempotentHint"
  | "openWorldHint"
  | "longRunHint";

export interface AnnotationBadgeProps {
  facet: AnnotationFacet;
  value: Role[] | number | boolean;
}

const colorMap: Record<AnnotationFacet, string> = {
  audience: "blue",
  priority: "orange",
  readOnlyHint: "green",
  destructiveHint: "red",
  idempotentHint: "teal",
  openWorldHint: "grape",
  longRunHint: "yellow",
};

function formatLabel(
  facet: AnnotationFacet,
  value: Role[] | number | boolean,
): string {
  switch (facet) {
    case "audience":
      return `audience: ${(value as Role[]).join(", ")}`;
    case "priority": {
      const n = value as number;
      if (n >= 0.7) return "priority: high";
      if (n >= 0.4) return "priority: medium";
      return "priority: low";
    }
    case "readOnlyHint":
      return "read-only";
    case "destructiveHint":
      return "destructive";
    case "idempotentHint":
      return "idempotent";
    case "openWorldHint":
      return "open-world";
    case "longRunHint":
      return "long-running";
  }
}

export function AnnotationBadge({ facet, value }: AnnotationBadgeProps) {
  const colorScheme = useComputedColorScheme();
  const color = colorMap[facet];
  const textColor = colorScheme === "dark" ? "black" : "white";
  return (
    <Badge color={color} variant="filled" fw={500} c={textColor}>
      {formatLabel(facet, value)}
    </Badge>
  );
}
