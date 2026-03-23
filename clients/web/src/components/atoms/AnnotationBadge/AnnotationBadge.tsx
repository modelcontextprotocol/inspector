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

const variantMap: Record<
  AnnotationVariant,
  { color: string; variant: string }
> = {
  audience: { color: "blue", variant: "outline" },
  readOnly: { color: "green", variant: "filled" },
  destructive: { color: "red", variant: "filled" },
  longRun: { color: "yellow", variant: "filled" },
  priority: { color: "orange", variant: "filled" },
  default: { color: "gray", variant: "light" },
};

export function AnnotationBadge({
  label,
  variant = "default",
}: AnnotationBadgeProps) {
  const colorScheme = useComputedColorScheme();
  const { color, variant: badgeVariant } = variantMap[variant];
  const textColor =
    (variant === "priority" || variant === "destructive") && colorScheme === "dark" ? "black" : undefined;

  return (
    <Badge color={color} variant={badgeVariant} c={textColor}>
      {label}
    </Badge>
  );
}
