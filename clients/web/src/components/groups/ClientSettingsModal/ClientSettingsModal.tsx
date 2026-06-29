import { useState } from "react";
import { CloseButton, Group, Modal, Stack, Title } from "@mantine/core";
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

const ALL_SECTIONS: ClientSettingsSection[] = ["ema"];

export interface ClientSettingsModalProps {
  opened: boolean;
  settings: ClientSettingsFormValues;
  onClose: () => void;
  onSettingsChange: (settings: ClientSettingsFormValues) => void;
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
  const [revealIssuerError, setRevealIssuerError] = useState(false);

  const allExpanded = expandedSections.length === ALL_SECTIONS.length;

  function handleToggleAll() {
    setExpandedSections(allExpanded ? [] : ALL_SECTIONS);
  }

  // Closing (X / Esc / overlay) is the implicit "save" for this auto-saving
  // modal — the parent flushes the debounced persist on close. If the issuer is
  // invalid the persist gate would silently drop it, so instead of closing we
  // reveal the issuer error (overriding the form's on-blur gating). The user
  // can fix the URL or clear the field — an empty issuer is valid to leave —
  // and then close. Resets via the parent's open/close remount key.
  function handleClose() {
    if (validateClientSettings(settings).issuer) {
      setRevealIssuerError(true);
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
          <Title order={4} ta="center" flex={1}>
            Client Settings
          </Title>
          <CloseButton onClick={handleClose} />
        </Group>
        <ClientSettingsForm
          settings={settings}
          expandedSections={expandedSections}
          onExpandedSectionsChange={setExpandedSections}
          onSettingsChange={onSettingsChange}
          emaIdpLoginState={emaIdpLoginState}
          onEmaIdpLogout={onEmaIdpLogout}
          revealIssuerError={revealIssuerError}
        />
      </Stack>
    </Modal>
  );
}
