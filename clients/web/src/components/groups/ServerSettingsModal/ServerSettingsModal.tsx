import { useState } from "react";
import { CloseButton, Group, Modal, Stack, Title } from "@mantine/core";
import type {
  InspectorServerSettings,
  OAuthSettings,
  ServerType,
} from "@inspector/core/mcp/types.js";
import { isOAuthCapableServerType } from "@inspector/core/mcp/config.js";
import { ListToggle } from "../../elements/ListToggle/ListToggle";
import {
  ServerSettingsForm,
  type ServerSettingsSection,
} from "../ServerSettingsForm/ServerSettingsForm";

const BASE_SECTIONS: ServerSettingsSection[] = [
  "options",
  "headers",
  "metadata",
  "timeouts",
  "roots",
];

function allSectionsFor(serverType: ServerType): ServerSettingsSection[] {
  return isOAuthCapableServerType(serverType)
    ? [...BASE_SECTIONS.slice(0, 4), "oauth", ...BASE_SECTIONS.slice(4)]
    : BASE_SECTIONS;
}

export interface ServerSettingsModalProps {
  opened: boolean;
  settings: InspectorServerSettings;
  serverType: ServerType;
  onClose: () => void;
  onSettingsChange: (settings: InspectorServerSettings) => void;
}

export function ServerSettingsModal({
  opened,
  settings,
  serverType,
  onClose,
  onSettingsChange,
}: ServerSettingsModalProps) {
  const sections = allSectionsFor(serverType);
  // Initial expansion is the first ("options") section — where Network Log
  // Size lives, so a deep-link from the body-dropped toast lands on the
  // relevant control. The parent remounts this modal per open (via `key`), so
  // this initial state re-applies on each open rather than persisting a
  // user's prior expand/collapse across opens.
  const [expandedSections, setExpandedSections] = useState<
    ServerSettingsSection[]
  >(["options"]);

  const allExpanded = expandedSections.length === sections.length;

  function handleToggleAll() {
    setExpandedSections(allExpanded ? [] : sections);
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
      enterpriseManaged: oauth.enterpriseManaged ? true : undefined,
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
          serverType={serverType}
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
