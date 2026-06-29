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
  const [revealIssuerError, setRevealIssuerError] = useState(false);
  const [revealClientMetadataUrlError, setRevealClientMetadataUrlError] =
    useState(false);

  const allExpanded = expandedSections.length === ALL_SECTIONS.length;

  function handleToggleAll() {
    setExpandedSections(allExpanded ? [] : ALL_SECTIONS);
  }

  // Closing (X / Esc / overlay) is the implicit "save" for this auto-saving
  // modal — the parent flushes the debounced persist on close. If a validated
  // URL field is invalid the persist gate would silently drop it, so instead of
  // closing we reveal the field error (overriding the form's on-blur gating).
  // The user can fix the URL or clear the field — an empty value is valid to
  // leave — and then close. Resets via the parent's open/close remount key.
  function handleClose() {
    const errors = validateClientSettings(settings);
    if (errors.issuer) {
      setRevealIssuerError(true);
    }
    if (errors.clientMetadataUrl) {
      setRevealClientMetadataUrlError(true);
    }
    if (errors.issuer || errors.clientMetadataUrl) {
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
          revealClientMetadataUrlError={revealClientMetadataUrlError}
        />
      </Stack>
    </Modal>
  );
}
