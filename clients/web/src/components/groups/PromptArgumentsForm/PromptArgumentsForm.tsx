import { Button, Group, Stack, Text, TextInput, Title } from "@mantine/core";
import type { Prompt } from "@modelcontextprotocol/sdk/types.js";

export interface PromptArgumentsFormProps {
  prompt: Prompt;
  argumentValues: Record<string, string>;
  onArgumentChange: (name: string, value: string) => void;
  onGetPrompt: () => void;
}

const PromptTitle = Text.withProps({
  fw: 700,
  size: "lg",
  truncate: "end",
});

const DescriptionText = Text.withProps({
  size: "sm",
  c: "dimmed",
});

function formatPlaceholder(name: string): string {
  return `Enter ${name}...`;
}

export function PromptArgumentsForm({
  prompt,
  argumentValues,
  onArgumentChange,
  onGetPrompt,
}: PromptArgumentsFormProps) {
  const { name, title, description, arguments: promptArguments } = prompt;

  return (
    <Stack gap="md">
      <PromptTitle>{title ?? name}</PromptTitle>
      {description && <DescriptionText>{description}</DescriptionText>}
      <Title order={4}>Arguments</Title>
      {promptArguments && promptArguments.length > 0 && (
        <Stack gap="sm">
          {promptArguments.map((arg) => (
            <TextInput
              key={arg.name}
              label={arg.name}
              withAsterisk={arg.required === true}
              description={arg.description}
              placeholder={formatPlaceholder(arg.name)}
              value={argumentValues[arg.name] || ""}
              onChange={(event) =>
                onArgumentChange(arg.name, event.currentTarget.value)
              }
            />
          ))}
        </Stack>
      )}
      <Group justify="flex-end">
        <Button size="sm" onClick={onGetPrompt}>
          Get Prompt
        </Button>
      </Group>
    </Stack>
  );
}
