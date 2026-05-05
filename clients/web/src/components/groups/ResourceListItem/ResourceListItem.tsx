import { Text, UnstyledButton } from "@mantine/core";
import type {
  Resource,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/types.js";

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
    <UnstyledButton
      w="100%"
      p="sm"
      variant="listItem"
      bg={selected ? "var(--mantine-primary-color-light)" : undefined}
      onClick={onClick}
    >
      <Text fw={500}>{resource.title ?? resource.name}</Text>
    </UnstyledButton>
  );
}
