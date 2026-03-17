import { Badge, Button, Code, Group, Loader, Paper, Stack, Text } from '@mantine/core'
import type { JsonSchema } from '../SchemaForm/SchemaForm'
import { SchemaForm } from '../SchemaForm/SchemaForm'

export interface InlineElicitationRequestProps {
  mode: 'form' | 'url'
  message: string
  queuePosition: string
  schema?: JsonSchema
  values?: Record<string, unknown>
  url?: string
  isWaiting?: boolean
  onChange: (values: Record<string, unknown>) => void
  onSubmit: () => void
  onCancel: () => void
}

export function InlineElicitationRequest({
  mode,
  message,
  queuePosition,
  schema,
  values,
  url,
  isWaiting,
  onChange,
  onSubmit,
  onCancel,
}: InlineElicitationRequestProps) {
  const badgeLabel =
    mode === 'form' ? 'elicitation/create (form)' : 'elicitation/create (url)'

  return (
    <Paper p="md" withBorder>
      <Stack gap="sm">
        <Group justify="space-between">
          <Badge color="violet">{badgeLabel}</Badge>
          <Text size="xs" c="dimmed">
            {queuePosition}
          </Text>
        </Group>

        <Text size="sm" fs="italic">
          {message}
        </Text>

        {mode === 'form' && schema && (
          <SchemaForm
            schema={schema}
            values={values ?? {}}
            onChange={onChange}
          />
        )}

        {mode === 'url' && url && (
          <>
            <Code block>{url}</Code>
            {isWaiting && (
              <Group>
                <Loader size="xs" />
                <Text size="xs">Waiting...</Text>
              </Group>
            )}
          </>
        )}

        <Group justify="flex-end" gap="xs">
          <Button size="xs" variant="light" onClick={onCancel}>
            Cancel
          </Button>
          {mode === 'form' && (
            <Button size="xs" onClick={onSubmit}>
              Submit
            </Button>
          )}
        </Group>
      </Stack>
    </Paper>
  )
}
