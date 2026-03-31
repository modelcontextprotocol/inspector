import { Stack, Text, UnstyledButton } from "@mantine/core";

export interface PromptListItemProps {
  name: string;
  description?: string;
  selected: boolean;
  onClick: () => void;
}

const NameText = Text.withProps({
  fw: 500,
});

const DescriptionText = Text.withProps({
  size: "xs",
  c: "dimmed",
  lineClamp: 1,
});

export function PromptListItem({
  name,
  description,
  selected,
  onClick,
}: PromptListItemProps) {
  return (
    <UnstyledButton
      w="100%"
      p="sm"
      variant="listItem"
      bg={selected ? "var(--mantine-primary-color-light)" : undefined}
      onClick={onClick}
    >
      <Stack gap={2}>
        <NameText>{name}</NameText>
        {description && <DescriptionText>{description}</DescriptionText>}
      </Stack>
    </UnstyledButton>
  );
}
