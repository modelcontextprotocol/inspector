import { useState } from "react";
import { CloseButton, Group, Modal, Stack } from "@mantine/core";
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

// The "environment" section only renders for stdio servers and the "oauth"
// section only for OAuth-capable transports, so each joins the
// expand/collapse-all set only when present — otherwise `allExpanded` could
// never be reached (a section not in the DOM can't be expanded).
function allSectionsFor(
  serverType: ServerType,
  isStdio: boolean,
): ServerSettingsSection[] {
  return [
    "options",
    ...(isStdio ? (["environment"] as const) : []),
    "headers",
    "metadata",
    "timeouts",
    ...(isOAuthCapableServerType(serverType) ? (["oauth"] as const) : []),
    "roots",
  ];
}

export interface ServerSettingsModalProps {
  opened: boolean;
  settings: InspectorServerSettings;
  serverType: ServerType;
  /**
   * Whether the target server uses the stdio transport. Forwarded to the form
   * to gate the stdio-only Working Directory field and Environment Variables
   * section.
   */
  isStdio: boolean;
  onClose: () => void;
  onSettingsChange: (settings: InspectorServerSettings) => void;
  onClearStoredOAuth?: () => void;
}

export function ServerSettingsModal({
  opened,
  settings,
  serverType,
  isStdio,
  onClose,
  onSettingsChange,
  onClearStoredOAuth,
}: ServerSettingsModalProps) {
  const sections = allSectionsFor(serverType, isStdio);
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

  function handleAddEnv() {
    onSettingsChange({
      ...settings,
      env: [...settings.env, { key: "", value: "" }],
    });
  }

  function handleRemoveEnv(index: number) {
    onSettingsChange({
      ...settings,
      env: settings.env.filter((_, i) => i !== index),
    });
  }

  function handleEnvChange(index: number, key: string, value: string) {
    const env = settings.env.map((e, i) => (i === index ? { key, value } : e));
    onSettingsChange({ ...settings, env });
  }

  function handleCwdChange(value: string) {
    onSettingsChange({ ...settings, cwd: value });
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
          {/* `Modal.Title` names the dialog (wires `aria-labelledby`). */}
          <Modal.Title ta="center" flex={1}>
            Server Settings
          </Modal.Title>
          <CloseButton aria-label="Close" onClick={onClose} />
        </Group>
        <ServerSettingsForm
          settings={settings}
          serverType={serverType}
          isStdio={isStdio}
          expandedSections={expandedSections}
          onExpandedSectionsChange={setExpandedSections}
          onAddHeader={handleAddHeader}
          onRemoveHeader={handleRemoveHeader}
          onHeaderChange={handleHeaderChange}
          onAddEnv={handleAddEnv}
          onRemoveEnv={handleRemoveEnv}
          onEnvChange={handleEnvChange}
          onCwdChange={handleCwdChange}
          onAddMetadata={handleAddMetadata}
          onRemoveMetadata={handleRemoveMetadata}
          onMetadataChange={handleMetadataChange}
          onTimeoutChange={handleTimeoutChange}
          onAutoRefreshChange={handleAutoRefreshChange}
          onMaxFetchRequestsChange={handleMaxFetchRequestsChange}
          onOAuthChange={handleOAuthChange}
          onClearStoredOAuth={onClearStoredOAuth}
          onAddRoot={handleAddRoot}
          onRemoveRoot={handleRemoveRoot}
          onRootChange={handleRootChange}
        />
      </Stack>
    </Modal>
  );
}
