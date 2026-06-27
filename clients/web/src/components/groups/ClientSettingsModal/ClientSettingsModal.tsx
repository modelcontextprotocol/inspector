import { useState } from "react";
import { CloseButton, Group, Modal, Stack, Title } from "@mantine/core";
import { ListToggle } from "../../elements/ListToggle/ListToggle";
import {
  ClientSettingsForm,
  type ClientSettingsSection,
} from "../ClientSettingsForm/ClientSettingsForm";
import type { EmaIdpLoginState } from "@inspector/core/auth/ema/idpSession.js";
import type { ClientSettingsFormValues } from "../ClientSettingsForm/clientSettingsValues.js";

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

  const allExpanded = expandedSections.length === ALL_SECTIONS.length;

  function handleToggleAll() {
    setExpandedSections(allExpanded ? [] : ALL_SECTIONS);
  }

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
          <ListToggle
            compact={!allExpanded}
            variant="subtle"
            onToggle={handleToggleAll}
          />
          <Title order={4} ta="center" flex={1}>
            Client Settings
          </Title>
          <CloseButton onClick={onClose} />
        </Group>
        <ClientSettingsForm
          settings={settings}
          expandedSections={expandedSections}
          onExpandedSectionsChange={setExpandedSections}
          onSettingsChange={onSettingsChange}
          emaIdpLoginState={emaIdpLoginState}
          onEmaIdpLogout={onEmaIdpLogout}
        />
      </Stack>
    </Modal>
  );
}
