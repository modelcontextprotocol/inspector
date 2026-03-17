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
      <Text size="md" fs="italic">
        &ldquo;{message}&rdquo;
      </Text>
      <Divider />
      <SchemaForm schema={schema} values={values} onChange={onChange} />
      <Alert color="yellow" title="Warning">
        Only provide information you trust this server with. The server &ldquo;
        {serverName}&rdquo; is requesting this data.
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
