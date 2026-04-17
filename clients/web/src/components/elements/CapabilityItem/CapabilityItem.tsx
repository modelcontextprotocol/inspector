import { Group, Text } from "@mantine/core";
import type {
  ClientCapabilities,
  ServerCapabilities,
} from "@modelcontextprotocol/sdk/types.js";

export type CapabilityKey = keyof ServerCapabilities | keyof ClientCapabilities;

export interface CapabilityItemProps {
  capability: CapabilityKey;
  supported: boolean;
  count?: number;
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
}: CapabilityItemProps) {
  const name = displayLabel[capability] ?? String(capability);
  const label = count != null ? `${name} (${count})` : name;

  return (
    <Group gap="xs">
      <Text c={supported ? "green" : "red"}>
        {supported ? "\u2713" : "\u2717"}
      </Text>
      <Text>{label}</Text>
    </Group>
  );
}
