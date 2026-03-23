import { Text, UnstyledButton } from "@mantine/core";

export interface ResourceAnnotations {
  audience?: string;
  priority?: number;
}

export interface ResourceListItemProps {
  name: string;
  uri: string;
  annotations?: ResourceAnnotations;
  selected: boolean;
  onClick: () => void;
}

export function ResourceListItem({
  name,
  selected,
  onClick,
}: ResourceListItemProps) {
  return (
    <UnstyledButton
      w="100%"
      p="sm"
      bg={selected ? "var(--mantine-primary-color-light)" : undefined}
      style={{ borderRadius: "var(--mantine-radius-md)" }}
      onClick={onClick}
    >
      <Text fw={500}>{name}</Text>
    </UnstyledButton>
  );
}
