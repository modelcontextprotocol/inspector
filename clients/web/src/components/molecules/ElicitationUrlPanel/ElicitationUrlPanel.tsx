import { Alert, Button, Code, Divider, Group, Loader, Stack, Text } from '@mantine/core'

export interface ElicitationUrlPanelProps {
  message: string
  url: string
  elicitationId: string
  isWaiting: boolean
  onCopyUrl: () => void
  onOpenInBrowser: () => void
  onCancel: () => void
}

export function ElicitationUrlPanel({
  message,
  url,
  elicitationId,
  isWaiting,
  onCopyUrl,
  onOpenInBrowser,
  onCancel,
}: ElicitationUrlPanelProps) {
  return (
    <Stack gap="md">
      <Text size="md" fs="italic">
        {message}
      </Text>
      <Divider />
      <Text size="sm">The server is requesting you visit:</Text>
      <Code block>{url}</Code>
      <Group>
        <Button variant="light" onClick={onCopyUrl}>
          Copy URL
        </Button>
        <Button variant="light" onClick={onOpenInBrowser}>
          Open in Browser
        </Button>
      </Group>
      <Divider />
      {isWaiting && (
        <Group>
          <Loader size="sm" />
          <Text size="sm" c="dimmed">
            Waiting for completion...
          </Text>
        </Group>
      )}
      <Text size="xs" c="dimmed">
        Elicitation ID: {elicitationId}
      </Text>
      <Alert color="yellow" title="Warning">
        This will open an external URL. Verify the domain before proceeding.
      </Alert>
      <Group justify="flex-end">
        <Button variant="light" onClick={onCancel}>
          Cancel
        </Button>
      </Group>
    </Stack>
  )
}
