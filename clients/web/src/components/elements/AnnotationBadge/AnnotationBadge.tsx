import { Badge, useComputedColorScheme } from "@mantine/core";

export type AnnotationVariant =
  | "audience"
  | "readOnly"
  | "destructive"
  | "longRun"
  | "priority"
  | "default";

export interface AnnotationBadgeProps {
  label: string;
  variant?: AnnotationVariant;
}

const colorMap: Record<AnnotationVariant, string> = {
  audience: "blue",
  readOnly: "green",
  destructive: "red",
  longRun: "yellow",
  priority: "orange",
  default: "gray",
};

export function AnnotationBadge({
  label,
  variant = "default",
}: AnnotationBadgeProps) {
  const colorScheme = useComputedColorScheme();
  const color = colorMap[variant];
  const textColor = colorScheme === "dark" ? "black" : "white";
  return (
    <Badge color={color} variant="filled" fw={500} c={textColor}>
      {label}
    </Badge>
  );
}
