import { Stack, Text, UnstyledButton } from "@mantine/core";

export interface ToolListItemProps {
  name: string;
  title?: string;
  selected: boolean;
  onClick: () => void;
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
      bg={selected ? "var(--mantine-primary-color-light)" : undefined}
      style={{ borderRadius: "var(--mantine-radius-md)" }}
      onClick={onClick}
    >
      <Stack gap={2}>
        <Text fw={500} truncate>
          {title ?? name}
        </Text>
        {title && (
          <Text size="xs" c="dimmed" truncate>
            {name}
          </Text>
        )}
      </Stack>
    </UnstyledButton>
  );
}
