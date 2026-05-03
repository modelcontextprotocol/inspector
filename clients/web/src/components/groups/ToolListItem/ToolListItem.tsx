import { Stack, Text, UnstyledButton } from "@mantine/core";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { resolveDisplayLabel } from "../../../utils/toolUtils";

export interface ToolListItemProps {
  tool: Tool;
  selected: boolean;
  onClick: () => void;
}

const ItemLabel = Text.withProps({
  fw: 500,
  truncate: true,
});

const ItemSubLabel = Text.withProps({
  size: "xs",
  c: "dimmed",
  truncate: true,
});

export function ToolListItem({ tool, selected, onClick }: ToolListItemProps) {
  const { name, title } = tool;
  return (
    <UnstyledButton
      w="100%"
      p="sm"
      variant="listItem"
      bg={selected ? "var(--mantine-primary-color-light)" : undefined}
      onClick={onClick}
    >
      <Stack gap={2}>
        <ItemLabel>{resolveDisplayLabel(name, title)}</ItemLabel>
        {title && <ItemSubLabel>{name}</ItemSubLabel>}
      </Stack>
    </UnstyledButton>
  );
}
