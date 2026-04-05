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
  elicitationId: string;
  isWaiting: boolean;
  onCopyUrl: () => void;
  onOpenInBrowser: () => void;
  onCancel: () => void;
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

function formatElicitationId(id: string): string {
  return `Elicitation ID: ${id}`;
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
      <ItalicMessage>{message}</ItalicMessage>
      <Divider />
      <Text size="sm">The server is requesting you visit:</Text>
      <WrappingCode>{url}</WrappingCode>
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
          <HintText>Waiting for completion...</HintText>
        </Group>
      )}
      <MetaText>{formatElicitationId(elicitationId)}</MetaText>
      <Alert color="yellow" title="Warning">
        This will open an external URL. Verify the domain before proceeding.
      </Alert>
      <Group justify="flex-end">
        <Button variant="light" onClick={onCancel}>
          Cancel
        </Button>
      </Group>
    </Stack>
  );
}
