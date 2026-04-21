import { Alert, Button, Divider, Group, Stack, Text } from "@mantine/core";
import type { ElicitRequestFormParams } from "@modelcontextprotocol/sdk/types.js";
import { SchemaForm } from "../SchemaForm/SchemaForm";
import type { JsonSchema } from "../SchemaForm/SchemaForm";

export interface ElicitationFormPanelProps {
  request: ElicitRequestFormParams;
  serverName: string;
  values: Record<string, unknown>;
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
  request,
  serverName,
  values,
  onChange,
  onSubmit,
  onCancel,
}: ElicitationFormPanelProps) {
  return (
    <Stack gap="md">
      <QuotedMessage>{formatQuoted(request.message)}</QuotedMessage>
      <Divider />
      <SchemaForm
        schema={request.requestedSchema as JsonSchema}
        values={values}
        onChange={onChange}
      />
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
