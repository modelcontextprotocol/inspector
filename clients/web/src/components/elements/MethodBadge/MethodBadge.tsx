import { Badge } from "@mantine/core";

export interface MethodBadgeProps {
  /** Protocol/RPC method name, e.g. "tools/list". */
  method: string;
}

const MethodChip = Badge.withProps({
  autoContrast: false,
  bg: "var(--inspector-badge-method-bg)",
  c: "var(--inspector-badge-method-fg)",
});

/**
 * Badge labelling a Protocol/Network entry's method. A neutral charcoal chip with
 * light text, driven by `--inspector-badge-method-*` so it stays legible (not a
 * washed-out pale fill) in dark mode. Shared by `ProtocolEntry` and `NetworkEntry`.
 */
export function MethodBadge({ method }: MethodBadgeProps) {
  return <MethodChip>{method}</MethodChip>;
}
