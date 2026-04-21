import { useState } from "react";
import { CloseButton, Group, Modal, Title } from "@mantine/core";
import type { InspectorServerSettings } from "@inspector/core/mcp/types.js";
import { ListToggle } from "../../elements/ListToggle/ListToggle";
import {
  ServerSettingsForm,
  type ServerSettingsSection,
} from "../ServerSettingsForm/ServerSettingsForm";

const ALL_SECTIONS: ServerSettingsSection[] = [
  "connectionMode",
  "headers",
  "metadata",
  "timeouts",
  "oauth",
];

export interface ServerSettingsModalProps {
  opened: boolean;
  settings: InspectorServerSettings;
  onClose: () => void;
  onSettingsChange: (settings: InspectorServerSettings) => void;
}

export function ServerSettingsModal({
  opened,
  settings,
  onClose,
  onSettingsChange,
}: ServerSettingsModalProps) {
  const [expandedSections, setExpandedSections] = useState<
    ServerSettingsSection[]
  >(["connectionMode"]);

  const allExpanded = expandedSections.length === ALL_SECTIONS.length;

  function handleToggleAll() {
    setExpandedSections(allExpanded ? [] : ALL_SECTIONS);
  }

  function handleConnectionModeChange(mode: "proxy" | "direct") {
    onSettingsChange({ ...settings, connectionMode: mode });
  }

  function handleAddHeader() {
    onSettingsChange({
      ...settings,
      headers: [...settings.headers, { key: "", value: "" }],
    });
  }

  function handleRemoveHeader(index: number) {
    onSettingsChange({
      ...settings,
      headers: settings.headers.filter((_, i) => i !== index),
    });
  }

  function handleHeaderChange(index: number, key: string, value: string) {
    const headers = settings.headers.map((h, i) =>
      i === index ? { key, value } : h,
    );
    onSettingsChange({ ...settings, headers });
  }

  function handleAddMetadata() {
    onSettingsChange({
      ...settings,
      metadata: [...settings.metadata, { key: "", value: "" }],
    });
  }

  function handleRemoveMetadata(index: number) {
    onSettingsChange({
      ...settings,
      metadata: settings.metadata.filter((_, i) => i !== index),
    });
  }

  function handleMetadataChange(index: number, key: string, value: string) {
    const metadata = settings.metadata.map((m, i) =>
      i === index ? { key, value } : m,
    );
    onSettingsChange({ ...settings, metadata });
  }

  function handleTimeoutChange(field: string, value: number) {
    onSettingsChange({ ...settings, [field]: value });
  }

  function handleOAuthChange(field: string, value: string) {
    const oauthFieldMap: Record<string, string> = {
      clientId: "oauthClientId",
      clientSecret: "oauthClientSecret",
      scopes: "oauthScopes",
    };
    const settingsKey = oauthFieldMap[field] ?? field;
    onSettingsChange({ ...settings, [settingsKey]: value });
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      withCloseButton={false}
      title={
        <Group justify="space-between" wrap="nowrap" w="100%">
          <ListToggle
            compact={allExpanded}
            variant="subtle"
            onToggle={handleToggleAll}
          />
          <Title order={4} ta="center" style={{ flex: 1 }}>
            Server Settings
          </Title>
          <CloseButton onClick={onClose} />
        </Group>
      }
      size="lg"
      centered
      styles={{ title: { flex: 1 } }}
    >
      <ServerSettingsForm
        settings={settings}
        expandedSections={expandedSections}
        onExpandedSectionsChange={setExpandedSections}
        onConnectionModeChange={handleConnectionModeChange}
        onAddHeader={handleAddHeader}
        onRemoveHeader={handleRemoveHeader}
        onHeaderChange={handleHeaderChange}
        onAddMetadata={handleAddMetadata}
        onRemoveMetadata={handleRemoveMetadata}
        onMetadataChange={handleMetadataChange}
        onTimeoutChange={handleTimeoutChange}
        onOAuthChange={handleOAuthChange}
      />
    </Modal>
  );
}
