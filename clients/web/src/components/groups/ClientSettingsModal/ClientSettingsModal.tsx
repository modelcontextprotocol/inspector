import { useState } from "react";
import { CloseButton, Group, Modal, ScrollArea } from "@mantine/core";
import { ListToggle } from "../../elements/ListToggle/ListToggle";
import {
  ClientSettingsForm,
  type ClientSettingsSection,
} from "../ClientSettingsForm/ClientSettingsForm";
import type { EmaIdpLoginState } from "@inspector/core/auth/ema/idpSession.js";
import {
  validateClientSettings,
  type ClientSettingsFormValues,
} from "../ClientSettingsForm/clientSettingsValues.js";

const ALL_SECTIONS: ClientSettingsSection[] = ["ema", "cimd"];

export interface ClientSettingsModalProps {
  opened: boolean;
  settings: ClientSettingsFormValues;
  onClose: () => void;
  onSettingsChange: (
    settings:
      | ClientSettingsFormValues
      | ((prev: ClientSettingsFormValues) => ClientSettingsFormValues),
  ) => void;
  emaIdpLoginState?: EmaIdpLoginState;
  onEmaIdpLogout?: () => void;
}

export function ClientSettingsModal({
  opened,
  settings,
  onClose,
  onSettingsChange,
  emaIdpLoginState,
  onEmaIdpLogout,
}: ClientSettingsModalProps) {
  const [expandedSections, setExpandedSections] = useState<
    ClientSettingsSection[]
  >(["ema"]);
  const [revealErrors, setRevealErrors] = useState(false);

  const allExpanded = expandedSections.length === ALL_SECTIONS.length;

  function handleToggleAll() {
    setExpandedSections(allExpanded ? [] : ALL_SECTIONS);
  }

  // modal — the parent flushes the debounced persist on close. A client config
  // that's incomplete (blank required field) or invalid (bad issuer / CIMD URL)
  // would be silently dropped by the persist gate, so instead of closing we
  // reveal the field errors (overriding the form's on-blur gating) and keep the
  // modal open. The user fixes the fields, or disables the feature, then closes.
  // Resets via the parent's open/close remount key.
  function handleClose() {
    const errors = validateClientSettings(settings, { requireComplete: true });
    if (Object.keys(errors).length > 0) {
      setRevealErrors(true);
      return;
    }
    onClose();
  }

  return (
    // Compound Modal so the header lives in `Modal.Header` (sticky by design)
    // while `scrollAreaComponent` confines overflow to `Modal.Body` (#1698 —
    // kept consistent with ServerSettingsModal for when this grows enough to
    // scroll). `transitionProps` restores the fade-down animation the `Modal`
    // wrapper defaults to but `Modal.Root` does not.
    <Modal.Root
      opened={opened}
      onClose={handleClose}
      size="lg"
      centered
      scrollAreaComponent={ScrollArea.Autosize}
      transitionProps={{ transition: "fade-down", duration: 200 }}
    >
      <Modal.Overlay />
      <Modal.Content>
        <Modal.Header>
          <Group justify="space-between" wrap="nowrap" w="100%">
            <ListToggle
              compact={!allExpanded}
              variant="subtle"
              onToggle={handleToggleAll}
            />
            {/* `Modal.Title` names the dialog (wires `aria-labelledby`). */}
            <Modal.Title ta="center" flex={1}>
              Client Settings
            </Modal.Title>
            <CloseButton aria-label="Close" onClick={handleClose} />
          </Group>
        </Modal.Header>
        <Modal.Body>
          <ClientSettingsForm
            settings={settings}
            expandedSections={expandedSections}
            onExpandedSectionsChange={setExpandedSections}
            onSettingsChange={onSettingsChange}
            emaIdpLoginState={emaIdpLoginState}
            onEmaIdpLogout={onEmaIdpLogout}
            revealErrors={revealErrors}
          />
        </Modal.Body>
      </Modal.Content>
    </Modal.Root>
  );
}
