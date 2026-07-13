import { useState } from "react";
import { CloseButton, Group, Modal, Stack } from "@mantine/core";
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
    <Modal
      opened={opened}
      onClose={handleClose}
      withCloseButton={false}
      size="lg"
      centered
    >
      <Stack gap="md">
        <Group justify="space-between" wrap="nowrap">
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
        <ClientSettingsForm
          settings={settings}
          expandedSections={expandedSections}
          onExpandedSectionsChange={setExpandedSections}
          onSettingsChange={onSettingsChange}
          emaIdpLoginState={emaIdpLoginState}
          onEmaIdpLogout={onEmaIdpLogout}
          revealErrors={revealErrors}
        />
      </Stack>
    </Modal>
  );
}
