import { CloseButton, Group, Modal, Stack, Title } from "@mantine/core";
import type {
  ClientCapabilities,
  InitializeResult,
} from "@modelcontextprotocol/sdk/types.js";
import type { ServerType } from "@inspector/core/mcp/types.js";
import {
  ServerInfoContent,
  type OAuthDetails,
} from "../ServerInfoContent/ServerInfoContent";

export interface ServerInfoModalProps {
  opened: boolean;
  onClose: () => void;
  initializeResult: InitializeResult;
  clientCapabilities: ClientCapabilities;
  transport: ServerType;
  oauth?: OAuthDetails;
}

export function ServerInfoModal({
  opened,
  onClose,
  initializeResult,
  clientCapabilities,
  transport,
  oauth,
}: ServerInfoModalProps) {
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
          <Title order={4} flex={1}>
            Server Info
          </Title>
          <CloseButton onClick={onClose} />
        </Group>
        <ServerInfoContent
          initializeResult={initializeResult}
          clientCapabilities={clientCapabilities}
          transport={transport}
          oauth={oauth}
        />
      </Stack>
    </Modal>
  );
}
