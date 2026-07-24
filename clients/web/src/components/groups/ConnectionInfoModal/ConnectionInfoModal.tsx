import { CloseButton, Group, Modal, ScrollArea } from "@mantine/core";
import type {
  ClientCapabilities,
  DiscoverResult,
  InitializeResult,
  ProtocolEra,
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
  protocolEra?: ProtocolEra;
  discoverResult?: DiscoverResult;
  oauth?: OAuthDetails;
  onClearOAuth?: () => void;
}

export function ConnectionInfoModal({
  opened,
  onClose,
  initializeResult,
  clientCapabilities,
  transport,
  protocolEra,
  discoverResult,
  oauth,
  onClearOAuth,
}: ConnectionInfoModalProps) {
  return (
    // Compound Modal so the header lives in `Modal.Header` (sticky by design)
    // while `scrollAreaComponent` confines overflow to `Modal.Body` — otherwise
    // a long connection-info payload grows the whole modal past the viewport and
    // scrolls the header out of view (#1754, same fix as the settings modals in
    // #1698). The fade-down transition is supplied app-wide by `ThemeModalRoot`.
    <Modal.Root
      opened={opened}
      onClose={onClose}
      size="lg"
      centered
      scrollAreaComponent={ScrollArea.Autosize}
    >
      <Modal.Overlay />
      <Modal.Content>
        <Modal.Header>
          <Group justify="space-between" wrap="nowrap" w="100%">
            {/* `Modal.Title` (not a bare `Title`) registers the modal's
                accessible name — it wires the dialog's `aria-labelledby`. */}
            <Modal.Title flex={1}>Connection Info</Modal.Title>
            <CloseButton aria-label="Close" onClick={onClose} />
          </Group>
        </Modal.Header>
        <Modal.Body>
          <ConnectionInfoContent
            initializeResult={initializeResult}
            clientCapabilities={clientCapabilities}
            transport={transport}
            protocolEra={protocolEra}
            discoverResult={discoverResult}
            oauth={oauth}
            onClearOAuth={onClearOAuth}
          />
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}
