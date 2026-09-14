import { useState } from "react";
import { CloseButton, Group, Modal, ScrollArea } from "@mantine/core";
import type { ProtocolEra } from "@modelcontextprotocol/client";
import type {
  InspectorServerSettings,
  ModernLogLevel,
  OAuthSettings,
  RequestMetadata,
  ServerProtocolEra,
  ServerType,
} from "@inspector/core/mcp/types.js";
import { isOAuthCapableServerType } from "@inspector/core/mcp/config.js";
import { ADVERTISABLE_EXTENSIONS } from "@inspector/core/mcp/extensions.js";
import { ListToggle } from "../../elements/ListToggle/ListToggle";
import { SecretStorageFooter } from "../../elements/SecretStorageFooter/SecretStorageFooter";
import type { SecretStorageInfo } from "@inspector/core/auth/secret-storage-info.js";
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
    "extensions",
    ...(isStdio ? (["environment"] as const) : []),
    "headers",
    "metadata",
    "timeouts",
    ...(isOAuthCapableServerType(serverType) ? (["oauth"] as const) : []),
    "roots",
  ];
}

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

const CenteredModalTitle = Modal.Title.withProps({
  ta: "center",
  flex: 1,
});

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
  /**
   * The era this server actually negotiated, when it is the live connection.
   * Forwarded to the form to hide the modern "Log Level per Request" control on
   * an `auto` server that resolved to legacy (#1629). Undefined when this server
   * isn't the connected one.
   */
  negotiatedEra?: ProtocolEra;
  onClose: () => void;
  onSettingsChange: (settings: InspectorServerSettings) => void;
  onClearStoredOAuth?: () => void;
  /**
   * Where secrets typed here end up (#1950). This dialog holds the OAuth
   * client secret and every stdio `env:` value, so the footer states the
   * destination of what the user is about to type. Absent on a backend
   * that doesn't report a store; the footer then renders nothing.
   */
  secretStorage?: SecretStorageInfo;
}

export function ServerSettingsModal({
  opened,
  settings,
  serverType,
  isStdio,
  negotiatedEra,
  onClose,
  onSettingsChange,
  onClearStoredOAuth,
  secretStorage,
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

  function handleMetadataChange(metadata: RequestMetadata) {
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
      // #2018: kept as rows (blank ones included) so a half-typed parameter
      // survives a re-render; the drop-blank/omit-empty filtering happens on the
      // way to disk. An emptied list persists as `[]`, which writes nothing.
      oauthAuthorizationParams: oauth.authorizationParams,
      // #1906: an emptied field persists as undefined rather than `""` — the
      // read side treats a blank override as "not configured", and keeping the
      // two in step means clearing the input really clears the setting.
      oauthAuthorizationUrl: oauth.authorizationUrl || undefined,
      oauthTokenUrl: oauth.tokenUrl || undefined,
      enterpriseManaged: oauth.enterpriseManaged ? true : undefined,
      // SEP-2350: persist only the non-default ('throw') so unset servers keep
      // the SDK's `reauthorize` behavior without writing a spurious field.
      oauthOnInsufficientScope:
        oauth.onInsufficientScope === "throw" ? "throw" : undefined,
      // #2068: persist only the non-default (off). `undefined` means on, so a
      // server that never touched the switch writes no field at all.
      oauthRequestRefreshToken:
        oauth.requestRefreshToken === false ? false : undefined,
      // #2144: same shape — `undefined` means on, so only the opt-out persists.
      oauthRevokeOnClear: oauth.revokeOnClear === false ? false : undefined,
    });
  }

  function handleAutoRefreshChange(value: boolean) {
    onSettingsChange({ ...settings, autoRefreshOnListChanged: value });
  }

  function handlePaginatedListsChange(value: boolean) {
    onSettingsChange({ ...settings, paginatedLists: value });
  }

  function handleAdvertisedExtensionChange(key: string, checked: boolean) {
    const next = { ...settings.advertisedExtensions };
    const ext = ADVERTISABLE_EXTENSIONS.find((e) => e.key === key);
    // Reconverge to "no override" when the toggle returns to the registry
    // default, so the on-disk map (and its byte-stable round-trip) stays minimal
    // — matching the omit-when-default policy used for the other settings. Only
    // a value that actually differs from the default is persisted.
    if (ext && checked === ext.defaultAdvertised) {
      delete next[key];
    } else {
      next[key] = checked;
    }
    onSettingsChange({
      ...settings,
      advertisedExtensions: Object.keys(next).length > 0 ? next : undefined,
    });
  }

  function handleMaxFetchRequestsChange(value: number) {
    onSettingsChange({ ...settings, maxFetchRequests: value });
  }

  function handleProtocolEraChange(value: ServerProtocolEra) {
    onSettingsChange({ ...settings, protocolEra: value });
  }

  function handleModernLogLevelChange(value: ModernLogLevel) {
    onSettingsChange({ ...settings, modernLogLevel: value });
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
    // Compound Modal so the header lives in `Modal.Header` (sticky by design)
    // while `scrollAreaComponent` confines overflow to `Modal.Body` — otherwise
    // expanding enough accordion sections grows the whole modal past the
    // viewport and scrolls the header out of view (#1698). The fade-down
    // transition `<Modal>` defaults to (but `Modal.Root` doesn't inherit) is
    // supplied app-wide by `ThemeModalRoot`.
    <AppModalLg opened={opened} onClose={onClose}>
      <Modal.Overlay />
      <Modal.Content>
        <Modal.Header>
          <ModalHeaderRow>
            <ListToggle
              compact={!allExpanded}
              variant="subtle"
              onToggle={handleToggleAll}
            />
            {/* `Modal.Title` names the dialog (wires `aria-labelledby`). */}
            <CenteredModalTitle>Server Settings</CenteredModalTitle>
            <CloseButton aria-label="Close" onClick={onClose} />
          </ModalHeaderRow>
        </Modal.Header>
        <Modal.Body>
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
            onMetadataChange={handleMetadataChange}
            onTimeoutChange={handleTimeoutChange}
            onAutoRefreshChange={handleAutoRefreshChange}
            onPaginatedListsChange={handlePaginatedListsChange}
            onAdvertisedExtensionChange={handleAdvertisedExtensionChange}
            onMaxFetchRequestsChange={handleMaxFetchRequestsChange}
            onProtocolEraChange={handleProtocolEraChange}
            onModernLogLevelChange={handleModernLogLevelChange}
            negotiatedEra={negotiatedEra}
            onOAuthChange={handleOAuthChange}
            onClearStoredOAuth={onClearStoredOAuth}
            onAddRoot={handleAddRoot}
            onRemoveRoot={handleRemoveRoot}
            onRootChange={handleRootChange}
          />
        </Modal.Body>
        <SecretStorageFooter info={secretStorage} />
      </Modal.Content>
    </AppModalLg>
  );
}
