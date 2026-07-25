import { Text, UnstyledButton } from "@mantine/core";
import type {
  Resource,
  ResourceTemplateType as ResourceTemplate,
} from "@modelcontextprotocol/client";

const ListItemButton = UnstyledButton.withProps({
  w: "100%",
  p: "sm",
  variant: "listItem",
});

export interface ResourceListItemProps {
  resource: Resource | ResourceTemplate;
  selected: boolean;
  onClick: () => void;
}

export function ResourceListItem({
  resource,
  selected,
  onClick,
}: ResourceListItemProps) {
  return (
    <ListItemButton
      bg={selected ? "var(--mantine-primary-color-light)" : undefined}
      onClick={onClick}
    >
      <Text fw={500}>{resource.title ?? resource.name}</Text>
    </ListItemButton>
  );
}
