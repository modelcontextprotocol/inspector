import { Stack, Text, UnstyledButton } from "@mantine/core";

export interface ToolListItemProps {
  name: string;
  title?: string;
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

function resolveLabel(name: string, title?: string): string {
  return title ?? name;
}

export function ToolListItem({
  name,
  title,
  selected,
  onClick,
}: ToolListItemProps) {
  return (
    <UnstyledButton
      w="100%"
      p="sm"
      variant="listItem"
      bg={selected ? "var(--mantine-primary-color-light)" : undefined}
      onClick={onClick}
    >
      <Stack gap={2}>
        <ItemLabel>{resolveLabel(name, title)}</ItemLabel>
        {title && <ItemSubLabel>{name}</ItemSubLabel>}
      </Stack>
    </UnstyledButton>
  );
}
