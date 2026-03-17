import { Group, Stack, Text, UnstyledButton } from "@mantine/core";
import { AnnotationBadge } from "../../atoms/AnnotationBadge/AnnotationBadge";
import type { AnnotationVariant } from "../../atoms/AnnotationBadge/AnnotationBadge";

export interface ToolAnnotation {
  label: string;
  variant?: AnnotationVariant;
}

export interface ToolListItemProps {
  name: string;
  annotations?: ToolAnnotation[];
  selected: boolean;
  onClick: () => void;
}

export function ToolListItem({
  name,
  annotations,
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
      <Stack gap="xs">
        <Text fw={500}>{name}</Text>
        {annotations && annotations.length > 0 && (
          <Group gap="xs">
            {annotations.map((annotation) => (
              <AnnotationBadge
                key={annotation.label}
                label={annotation.label}
                variant={annotation.variant}
              />
            ))}
          </Group>
        )}
      </Stack>
    </UnstyledButton>
  );
}
