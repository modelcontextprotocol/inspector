import { Button, Select, Stack, Text, TextInput, Title } from "@mantine/core";

export interface PromptArgument {
  name: string;
  required: boolean;
  description?: string;
}

export interface PromptInfo {
  name: string;
  description?: string;
}

export interface PromptArgumentsFormProps {
  prompts: PromptInfo[];
  selectedPrompt?: string;
  arguments: PromptArgument[];
  argumentValues: Record<string, string>;
  onSelectPrompt: (name: string) => void;
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
  prompts,
  selectedPrompt,
  arguments: promptArguments,
  argumentValues,
  onSelectPrompt,
  onArgumentChange,
  onGetPrompt,
}: PromptArgumentsFormProps) {
  const selectedPromptInfo = prompts.find((p) => p.name === selectedPrompt);

  return (
    <Stack gap="md">
      <Title order={4}>Prompts</Title>
      <Select
        data={prompts.map((p) => ({ value: p.name, label: p.name }))}
        value={selectedPrompt ?? null}
        onChange={(value) => {
          if (value) {
            onSelectPrompt(value);
          }
        }}
        placeholder="Choose a prompt..."
      />
      {selectedPrompt && selectedPromptInfo?.description && (
        <DescriptionText>{selectedPromptInfo.description}</DescriptionText>
      )}
      {promptArguments.length > 0 && (
        <>
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
        </>
      )}
      <Button fullWidth onClick={onGetPrompt} disabled={!selectedPrompt}>
        Get Prompt
      </Button>
    </Stack>
  );
}
