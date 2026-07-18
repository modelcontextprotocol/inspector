import { Badge, Tooltip } from "@mantine/core";
import { filledBadgeColor } from "../filledBadgeColor";

export interface McpErrorBadgeProps {
  /** JSON-RPC error code, e.g. -32020. */
  code: number;
  /** Spec name, e.g. "HeaderMismatch". */
  name: string;
  /** Optional explanation shown on hover. */
  description?: string;
}

// Each modern spec error gets a distinct colour so the four are told apart at a
// glance in a dense Protocol stream (SEP-2243 / SEP-2575). Falls back to red for
// any other code routed here.
const COLOR_BY_CODE: Record<number, string> = {
  [-32020]: "red", // HeaderMismatch
  [-32021]: "orange", // MissingRequiredClientCapability
  [-32022]: "grape", // UnsupportedProtocolVersion
  [-32601]: "yellow", // MethodNotFound (modern 404)
};

/**
 * Distinct badge for one of the modern Streamable HTTP spec error codes shown in
 * the Protocol tab. Labels the code and spec name (e.g. "-32020 HeaderMismatch")
 * and, when a description is supplied, explains it on hover.
 *
 * Uses the filled + `autoContrast` treatment (via {@link filledBadgeColor}) like
 * the other semantic badges, so the amber fills clear WCAG AA — a light-variant
 * tint of these hues does not.
 */
export function McpErrorBadge({ code, name, description }: McpErrorBadgeProps) {
  const badge = (
    <Badge
      color={filledBadgeColor(COLOR_BY_CODE[code] ?? "red")}
      variant="filled"
      autoContrast
      // Keep the spec/SDK identifier's own casing (e.g. "UnsupportedProtocolVersion")
      // rather than Mantine's default uppercase, which runs these long
      // PascalCase names together and hurts readability.
      tt="none"
    >
      {code} {name}
    </Badge>
  );
  if (!description) return badge;
  return (
    <Tooltip label={description} multiline w={280} withArrow>
      {badge}
    </Tooltip>
  );
}
