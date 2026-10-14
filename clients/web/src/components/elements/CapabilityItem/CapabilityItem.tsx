import { Group, Text } from "@mantine/core";
import type {
  ClientCapabilities,
  ServerCapabilities,
} from "@modelcontextprotocol/client";
import { formatCountedLabel } from "../../../utils/listCount";

export type CapabilityKey = keyof ServerCapabilities | keyof ClientCapabilities;

export interface CapabilityItemProps {
  capability: CapabilityKey;
  supported: boolean;
  /** Length of the capability's list result (`tools/list`, …) (#2607). */
  count?: number;
  /**
   * True when `count` covers only the pages loaded so far — the server has a
   * `nextCursor` still unloaded — so it renders as a lower bound (`10+`).
   */
  partial?: boolean;
}

const displayLabel: Record<string, string> = {
  tools: "Tools",
  resources: "Resources",
  prompts: "Prompts",
  logging: "Logging",
  completions: "Completions",
  tasks: "Tasks",
  experimental: "Experimental",
  roots: "Roots",
  sampling: "Sampling",
  elicitation: "Elicitation",
};

export function CapabilityItem({
  capability,
  supported,
  count,
  partial = false,
}: CapabilityItemProps) {
  const name = displayLabel[capability] ?? String(capability);
  const label = formatCountedLabel(
    name,
    count != null ? { count, partial } : undefined,
  );

  return (
    <Group gap="xs">
      <Text c={supported ? "green" : "red"}>
        {supported ? "\u2713" : "\u2717"}
      </Text>
      <Text>{label}</Text>
    </Group>
  );
}
