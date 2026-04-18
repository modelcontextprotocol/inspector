import { Stack, Text, UnstyledButton } from "@mantine/core";
import type { Prompt } from "@modelcontextprotocol/sdk/types.js";

export interface PromptListItemProps {
  prompt: Prompt;
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
  prompt,
  selected,
  onClick,
}: PromptListItemProps) {
  const { name, title, description } = prompt;
  return (
    <UnstyledButton
      w="100%"
      p="sm"
      variant="listItem"
      bg={selected ? "var(--mantine-primary-color-light)" : undefined}
      onClick={onClick}
    >
      <Stack gap={2}>
        <NameText>{title ?? name}</NameText>
        {description && <DescriptionText>{description}</DescriptionText>}
      </Stack>
    </UnstyledButton>
  );
}
