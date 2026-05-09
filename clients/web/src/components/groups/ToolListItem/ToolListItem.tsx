import { Group, Image, Stack, Text, UnstyledButton } from "@mantine/core";
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

const ItemBody = Stack.withProps({
  gap: 2,
  flex: 1,
  miw: 0,
});

const Row = Group.withProps({
  gap: "sm",
  wrap: "nowrap",
  align: "flex-start",
});

const ToolIcon = Image.withProps({
  w: 20,
  h: 20,
  fit: "contain",
});

export function ToolListItem({ tool, selected, onClick }: ToolListItemProps) {
  const { name, title, icons } = tool;
  const iconSrc = icons?.[0]?.src;

  return (
    <UnstyledButton
      w="100%"
      p="sm"
      variant="listItem"
      bg={selected ? "var(--mantine-primary-color-light)" : undefined}
      onClick={onClick}
    >
      <Row>
        {iconSrc && <ToolIcon src={iconSrc} alt="" />}
        <ItemBody>
          <ItemLabel>{resolveDisplayLabel(name, title)}</ItemLabel>
          {title && <ItemSubLabel>{name}</ItemSubLabel>}
        </ItemBody>
      </Row>
    </UnstyledButton>
  );
}
