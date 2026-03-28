import { Alert, Button, Divider, Group, Stack, Text } from "@mantine/core";
import type { JsonSchema } from "../SchemaForm/SchemaForm";
import { SchemaForm } from "../SchemaForm/SchemaForm";

export interface ElicitationFormPanelProps {
  message: string;
  schema: JsonSchema;
  values: Record<string, unknown>;
  serverName: string;
  onChange: (values: Record<string, unknown>) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

const QuotedMessage = Text.withProps({
  size: "md",
  fs: "italic",
});

function formatQuoted(text: string): string {
  return `\u201C${text}\u201D`;
}

function formatWarning(serverName: string): string {
  return `Only provide information you trust this server with. The server \u201C${serverName}\u201D is requesting this data.`;
}

export function ElicitationFormPanel({
  message,
  schema,
  values,
  serverName,
  onChange,
  onSubmit,
  onCancel,
}: ElicitationFormPanelProps) {
  return (
    <Stack gap="md">
      <QuotedMessage>{formatQuoted(message)}</QuotedMessage>
      <Divider />
      <SchemaForm schema={schema} values={values} onChange={onChange} />
      <Alert color="yellow" title="Warning">
        {formatWarning(serverName)}
      </Alert>
      <Group justify="flex-end">
        <Button variant="light" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={onSubmit}>Submit</Button>
      </Group>
    </Stack>
  );
}
