import { Group, Image, Stack, Text, UnstyledButton } from "@mantine/core";
import { MdChevronRight } from "react-icons/md";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export interface AppListItemProps {
  tool: Tool;
  selected: boolean;
  onClick: () => void;
}

const ItemLabel = Text.withProps({
  fw: 500,
  truncate: true,
});

const ItemDescription = Text.withProps({
  size: "xs",
  c: "dimmed",
  lineClamp: 2,
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

const AppIcon = Image.withProps({
  w: 20,
  h: 20,
  fit: "contain",
});

function resolveLabel(name: string, title?: string): string {
  return title ?? name;
}

export function AppListItem({ tool, selected, onClick }: AppListItemProps) {
  const { name, title, description, icons } = tool;
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
        {iconSrc && <AppIcon src={iconSrc} alt="" />}
        <ItemBody>
          <ItemLabel>{resolveLabel(name, title)}</ItemLabel>
          {description && <ItemDescription>{description}</ItemDescription>}
        </ItemBody>
        <MdChevronRight
          aria-hidden
          color="var(--inspector-text-secondary)"
          size={18}
        />
      </Row>
    </UnstyledButton>
  );
}
