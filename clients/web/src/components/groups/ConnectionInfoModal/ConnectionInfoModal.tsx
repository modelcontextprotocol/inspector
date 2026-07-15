import { CloseButton, Group, Modal, Stack } from "@mantine/core";
import type {
  ClientCapabilities,
  InitializeResult,
} from "@modelcontextprotocol/client";
import type { ServerType } from "@inspector/core/mcp/types.js";
import {
  ConnectionInfoContent,
  type OAuthDetails,
} from "../ConnectionInfoContent/ConnectionInfoContent";

export interface ConnectionInfoModalProps {
  opened: boolean;
  onClose: () => void;
  initializeResult: InitializeResult;
  clientCapabilities: ClientCapabilities;
  transport: ServerType;
  oauth?: OAuthDetails;
  onClearOAuth?: () => void;
}

export function ConnectionInfoModal({
  opened,
  onClose,
  initializeResult,
  clientCapabilities,
  transport,
  oauth,
  onClearOAuth,
}: ConnectionInfoModalProps) {
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      withCloseButton={false}
      size="lg"
      centered
    >
      <Stack gap="md">
        <Group justify="space-between" wrap="nowrap">
          {/* `Modal.Title` (not a bare `Title`) registers the modal's
              accessible name — it wires the dialog's `aria-labelledby`. */}
          <Modal.Title flex={1}>Connection Info</Modal.Title>
          <CloseButton aria-label="Close" onClick={onClose} />
        </Group>
        <ConnectionInfoContent
          initializeResult={initializeResult}
          clientCapabilities={clientCapabilities}
          transport={transport}
          oauth={oauth}
          onClearOAuth={onClearOAuth}
        />
      </Stack>
    </Modal>
  );
}
