import { useState } from "react";
import { CloseButton, Group, Modal, Stack, Title } from "@mantine/core";
import type {
  InspectorServerSettings,
  OAuthSettings,
} from "@inspector/core/mcp/types.js";
import { ListToggle } from "../../elements/ListToggle/ListToggle";
import {
  ServerSettingsForm,
  type ServerSettingsSection,
} from "../ServerSettingsForm/ServerSettingsForm";

const ALL_SECTIONS: ServerSettingsSection[] = [
  "options",
  "headers",
  "metadata",
  "timeouts",
  "oauth",
  "roots",
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
  // Initial expansion is the first ("options") section — where Network Log
  // Size lives, so a deep-link from the body-dropped toast lands on the
  // relevant control. The parent remounts this modal per open (via `key`), so
  // this initial state re-applies on each open rather than persisting a
  // user's prior expand/collapse across opens.
  const [expandedSections, setExpandedSections] = useState<
    ServerSettingsSection[]
  >(["options"]);

  const allExpanded = expandedSections.length === ALL_SECTIONS.length;

  function handleToggleAll() {
    setExpandedSections(allExpanded ? [] : ALL_SECTIONS);
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

  function handleTimeoutChange(
    field: "connectionTimeout" | "requestTimeout" | "taskTtl",
    value: number,
  ) {
    onSettingsChange({ ...settings, [field]: value });
  }

  function handleOAuthChange(oauth: OAuthSettings) {
    onSettingsChange({
      ...settings,
      oauthClientId: oauth.clientId,
      oauthClientSecret: oauth.clientSecret,
      oauthScopes: oauth.scopes,
    });
  }

  function handleAutoRefreshChange(value: boolean) {
    onSettingsChange({ ...settings, autoRefreshOnListChanged: value });
  }

  function handleMaxFetchRequestsChange(value: number) {
    onSettingsChange({ ...settings, maxFetchRequests: value });
  }

  function handleAddRoot() {
    onSettingsChange({
      ...settings,
      roots: [...settings.roots, { uri: "", name: "" }],
    });
  }

  function handleRemoveRoot(index: number) {
    onSettingsChange({
      ...settings,
      roots: settings.roots.filter((_, i) => i !== index),
    });
  }

  function handleRootChange(index: number, uri: string, name: string) {
    // Spread the existing root so any non-form fields (e.g. `_meta` from a
    // hand-edited mcp.json) survive an edit; only `uri`/`name` are overwritten.
    const roots = settings.roots.map((r, i) =>
      i === index ? { ...r, uri, name } : r,
    );
    onSettingsChange({ ...settings, roots });
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
            Server Settings
          </Title>
          <CloseButton onClick={onClose} />
        </Group>
        <ServerSettingsForm
          settings={settings}
          expandedSections={expandedSections}
          onExpandedSectionsChange={setExpandedSections}
          onAddHeader={handleAddHeader}
          onRemoveHeader={handleRemoveHeader}
          onHeaderChange={handleHeaderChange}
          onAddMetadata={handleAddMetadata}
          onRemoveMetadata={handleRemoveMetadata}
          onMetadataChange={handleMetadataChange}
          onTimeoutChange={handleTimeoutChange}
          onAutoRefreshChange={handleAutoRefreshChange}
          onMaxFetchRequestsChange={handleMaxFetchRequestsChange}
          onOAuthChange={handleOAuthChange}
          onAddRoot={handleAddRoot}
          onRemoveRoot={handleRemoveRoot}
          onRootChange={handleRootChange}
        />
      </Stack>
    </Modal>
  );
}
