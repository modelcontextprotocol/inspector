import {
  Alert,
  Button,
  Code,
  Divider,
  Group,
  Loader,
  Stack,
  Text,
} from "@mantine/core";

export interface ElicitationUrlPanelProps {
  message: string;
  url: string;
  requestId: string;
  isWaiting: boolean;
  onCopyUrl: () => void;
  onOpenInBrowser: () => void;
  onCancel: () => void;
  /**
   * A response has been dispatched; lock the responding actions so a second
   * click can't resolve the request twice (the handler throws if called
   * again). Copy URL stays enabled — it doesn't resolve the request.
   */
  busy?: boolean;
}

const ItalicMessage = Text.withProps({
  size: "md",
  fs: "italic",
});

const WrappingCode = Code.withProps({
  block: true,
  variant: "wrapping",
});

const HintText = Text.withProps({
  size: "sm",
  c: "dimmed",
});

const MetaText = Text.withProps({
  size: "xs",
  c: "dimmed",
});

function formatRequestId(id: string): string {
  return `Request ID: ${id}`;
}

export function ElicitationUrlPanel({
  message,
  url,
  requestId,
  isWaiting,
  onCopyUrl,
  onOpenInBrowser,
  onCancel,
  busy = false,
}: ElicitationUrlPanelProps) {
  return (
    <Stack gap="md">
      <ItalicMessage>{message}</ItalicMessage>
      <Divider />
      <Text size="sm">The server is requesting you visit:</Text>
      <WrappingCode>{url}</WrappingCode>
      <Group>
        <Button variant="light" onClick={onCopyUrl}>
          Copy URL
        </Button>
        <Button variant="light" onClick={onOpenInBrowser} disabled={busy}>
          Open in Browser
        </Button>
      </Group>
      <Divider />
      {isWaiting && (
        <Group>
          <Loader size="sm" />
          <HintText>Waiting for completion...</HintText>
        </Group>
      )}
      <MetaText>{formatRequestId(requestId)}</MetaText>
      <Alert color="yellow" title="Warning">
        This will open an external URL. Verify the domain before proceeding.
      </Alert>
      <Group justify="flex-end">
        <Button variant="light" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </Group>
    </Stack>
  );
}
