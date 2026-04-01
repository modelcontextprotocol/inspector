import { Button, Group, Stack, Text, TextInput, Title } from "@mantine/core";

export interface PromptArgument {
  name: string;
  required: boolean;
  description?: string;
}

export interface PromptArgumentsFormProps {
  name: string;
  description?: string;
  arguments: PromptArgument[];
  argumentValues: Record<string, string>;
  onArgumentChange: (name: string, value: string) => void;
  onGetPrompt: () => void;
}

const DescriptionText = Text.withProps({
  size: "sm",
  c: "dimmed",
});

function formatPlaceholder(name: string): string {
  return `Enter ${name}...`;
}

export function PromptArgumentsForm({
  description,
  arguments: promptArguments,
  argumentValues,
  onArgumentChange,
  onGetPrompt,
}: PromptArgumentsFormProps) {
  return (
    <Stack gap="md">
      <Title order={4}>Prompt Arguments</Title>
      {description && <DescriptionText>{description}</DescriptionText>}
      {promptArguments.length > 0 && (
        <Stack gap="sm">
          {promptArguments.map((arg) => (
            <TextInput
              key={arg.name}
              label={arg.name}
              withAsterisk={arg.required}
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
