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

const AppModalLg = Modal.Root.withProps({
  size: "lg",
  centered: true,
  scrollAreaComponent: ScrollArea.Autosize,
});

const ModalHeaderRow = Group.withProps({
  justify: "space-between",
  wrap: "nowrap",
  w: "100%",
});

export interface ConnectionInfoModalProps {
  opened: boolean;
  onClose: () => void;
  initializeResult: InitializeResult;
  /**
   * Whether the server actually reported `serverInfo`. False for a modern server
   * that omitted the optional `_meta` stamp — in which case `initializeResult`'s
   * name is a client-side catalog fallback, and the modal shows "not reported"
   * rather than passing it off as server-sent (#1772).
   */
  serverInfoReported: boolean;
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
  serverInfoReported,
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
    <AppModalLg opened={opened} onClose={onClose}>
      <Modal.Overlay />
      <Modal.Content>
        <Modal.Header>
          <ModalHeaderRow>
            {/* `Modal.Title` (not a bare `Title`) registers the modal's
                accessible name — it wires the dialog's `aria-labelledby`. */}
            <Modal.Title flex={1}>Connection Info</Modal.Title>
            <CloseButton aria-label="Close" onClick={onClose} />
          </ModalHeaderRow>
        </Modal.Header>
        <Modal.Body>
          <ConnectionInfoContent
            initializeResult={initializeResult}
            serverInfoReported={serverInfoReported}
            clientCapabilities={clientCapabilities}
            transport={transport}
            protocolEra={protocolEra}
            discoverResult={discoverResult}
            oauth={oauth}
            onClearOAuth={onClearOAuth}
          />
        </Modal.Body>
      </Modal.Content>
    </AppModalLg>
  );
}
