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
import type { PendingRequestOrigin } from "@inspector/core/mcp/types.js";
import { MrtrOriginNote } from "../../elements/MrtrOriginNote/MrtrOriginNote";

export interface ElicitationUrlPanelProps {
  message: string;
  url: string;
  requestId: string;
  /**
   * How the request reached the Inspector — a legacy server→client request or a
   * modern MRTR `input_required` round. Drives the era-accurate note; defaults
   * to `"server-request"` (legacy, note hidden). (#1704)
   */
  origin?: PendingRequestOrigin;
  /**
   * The URL has been opened and we're waiting for the user to confirm they
   * finished the external flow. Reveals the "I've completed it" action; opening
   * the URL does not resolve the elicitation on its own.
   */
  isWaiting: boolean;
  onCopyUrl: () => void;
  onOpenInBrowser: () => void;
  /** User confirms the external flow is done — sends `accept`. */
  onComplete: () => void;
  onCancel: () => void;
  /**
   * A response has been dispatched; lock the responding actions so a second
   * click can't resolve the request twice (the handler throws if called
   * again). Copy URL stays enabled — it doesn't resolve the request.
   */
  busy?: boolean;
  /**
   * Why the URL may not be opened (e.g. a non-http(s) scheme). When set, Open
   * in Browser is disabled and the reason is shown, so a refused URL reads as
   * refused rather than as a button that silently does nothing.
   */
  openRefusal?: string;
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

const WarningAlert = Alert.withProps({
  variant: "warning",
  title: "Warning",
});

const RefusalAlert = Alert.withProps({
  color: "red",
  variant: "light",
  title: "URL refused",
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
  onComplete,
  onCancel,
  origin = "server-request",
  busy = false,
  openRefusal,
}: ElicitationUrlPanelProps) {
  return (
    <Stack gap="md">
      <ItalicMessage>{message}</ItalicMessage>
      <MrtrOriginNote origin={origin} />
      <Divider />
      <Text size="sm">The server is requesting you visit:</Text>
      <WrappingCode>{url}</WrappingCode>
      <Group>
        <Button variant="light" onClick={onCopyUrl}>
          Copy URL
        </Button>
        <Button
          variant="light"
          onClick={onOpenInBrowser}
          disabled={busy || openRefusal !== undefined}
        >
          {isWaiting ? "Reopen in Browser" : "Open in Browser"}
        </Button>
      </Group>
      {openRefusal !== undefined && <RefusalAlert>{openRefusal}</RefusalAlert>}
      <Divider />
      {isWaiting && (
        <Group>
          <Loader size="sm" />
          <HintText>Waiting for completion...</HintText>
        </Group>
      )}
      <MetaText>{formatRequestId(requestId)}</MetaText>
      <WarningAlert>
        This will open an external URL. Verify the domain before proceeding.
      </WarningAlert>
      <Group justify="flex-end">
        <Button variant="light" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        {isWaiting && (
          <Button onClick={onComplete} disabled={busy}>
            I've completed it
          </Button>
        )}
      </Group>
    </Stack>
  );
}
