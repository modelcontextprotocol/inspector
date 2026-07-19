import {
  Accordion,
  ActionIcon,
  Button,
  Checkbox,
  Flex,
  Group,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { ClearButton } from "../../elements/ClearButton/ClearButton";
import type {
  InspectorServerSettings,
  ModernLogLevel,
  OAuthSettings,
  ServerProtocolEra,
  ServerType,
} from "@inspector/core/mcp/types.js";
import {
  DEFAULT_MODERN_LOG_LEVEL,
  DEFAULT_PROTOCOL_ERA,
  MODERN_LOG_LEVELS,
} from "@inspector/core/mcp/types.js";
import { isOAuthCapableServerType } from "@inspector/core/mcp/config.js";
import type { Root } from "@modelcontextprotocol/client";

export type ServerSettingsSection =
  | "options"
  | "environment"
  | "headers"
  | "metadata"
  | "timeouts"
  | "oauth"
  | "roots";

export interface ServerSettingsFormProps {
  settings: InspectorServerSettings;
  /** Transport type — EMA checkbox is hidden for stdio. Defaults to streamable-http. */
  serverType?: ServerType;
  /**
   * Whether the target server uses the stdio transport. Gates the Working
   * Directory field and Environment Variables section in the Options area —
   * both are stdio-only config concepts and hidden for sse / streamable-http.
   */
  isStdio: boolean;
  expandedSections: ServerSettingsSection[];
  onExpandedSectionsChange: (sections: ServerSettingsSection[]) => void;
  onAddHeader: () => void;
  onRemoveHeader: (index: number) => void;
  onHeaderChange: (index: number, key: string, value: string) => void;
  onAddEnv: () => void;
  onRemoveEnv: (index: number) => void;
  onEnvChange: (index: number, key: string, value: string) => void;
  onCwdChange: (value: string) => void;
  onAddMetadata: () => void;
  onRemoveMetadata: (index: number) => void;
  onMetadataChange: (index: number, key: string, value: string) => void;
  onTimeoutChange: (
    field: "connectionTimeout" | "requestTimeout" | "taskTtl",
    value: number,
  ) => void;
  onAutoRefreshChange: (value: boolean) => void;
  onPaginatedListsChange: (value: boolean) => void;
  onMaxFetchRequestsChange: (value: number) => void;
  onProtocolEraChange: (value: ServerProtocolEra) => void;
  onModernLogLevelChange: (value: ModernLogLevel) => void;
  onOAuthChange: (oauth: OAuthSettings) => void;
  onClearStoredOAuth?: () => void;
  onAddRoot: () => void;
  onRemoveRoot: (index: number) => void;
  onRootChange: (index: number, uri: string, name: string) => void;
}

// Protocol-era options (SEP §7.8). Values are `ServerProtocolEra`; the pinned
// modern revision is an internal detail (MODERN_PROTOCOL_VERSION), so the label
// stays version-free.
const PROTOCOL_ERA_OPTIONS: { value: ServerProtocolEra; label: string }[] = [
  { value: "legacy", label: "Legacy (2025-11-25 handshake)" },
  { value: "auto", label: "Auto (probe, fall back to legacy)" },
  { value: "modern", label: "Modern (2026-07-28, sessionless)" },
];

const PROTOCOL_ERA_VALUES: ReadonlySet<ServerProtocolEra> = new Set(
  PROTOCOL_ERA_OPTIONS.map((o) => o.value),
);

function isProtocolEra(value: string | null): value is ServerProtocolEra {
  return value !== null && PROTOCOL_ERA_VALUES.has(value as ServerProtocolEra);
}

// Modern per-request log-level options (#1629): "Off" plus the eight levels.
// Only meaningful on the modern era; labeled so the "Off" state reads clearly.
const MODERN_LOG_LEVEL_OPTIONS: { value: ModernLogLevel; label: string }[] =
  MODERN_LOG_LEVELS.map((level) => ({
    value: level,
    label: level === "off" ? "Off (no logs)" : level,
  }));

const MODERN_LOG_LEVEL_VALUES: ReadonlySet<ModernLogLevel> = new Set(
  MODERN_LOG_LEVELS,
);

function isModernLogLevelValue(value: string | null): value is ModernLogLevel {
  return value !== null && MODERN_LOG_LEVEL_VALUES.has(value as ModernLogLevel);
}

const RemoveIcon = ActionIcon.withProps({
  color: "red",
  variant: "subtle",
});

const AddButton = Button.withProps({
  size: "xs",
  variant: "light",
});

const HintText = Text.withProps({
  size: "sm",
  c: "dimmed",
});

const EmptyHint = Text.withProps({
  size: "sm",
  c: "dimmed",
  fs: "italic",
});

const ClearStoredOAuthButton = Button.withProps({
  variant: "light",
  color: "red",
  size: "compact-sm",
  flex: "0 0 auto",
});

const ClearStoredOAuthHint = Text.withProps({
  size: "sm",
  c: "dimmed",
  flex: 1,
  miw: "12rem",
});

function KeyValueRows({
  items,
  onChange,
  onRemove,
}: {
  items: { key: string; value: string }[];
  onChange: (index: number, key: string, value: string) => void;
  onRemove: (index: number) => void;
}) {
  /* v8 ignore next 3 -- unreachable: every caller guards with `length === 0`
     and renders an EmptyHint instead, so KeyValueRows is only mounted with
     a non-empty list. */
  if (items.length === 0) {
    return null;
  }

  return (
    <>
      {items.map((item, index) => (
        <Group key={index} grow>
          <TextInput
            placeholder="Key"
            value={item.key}
            onChange={(e) => onChange(index, e.currentTarget.value, item.value)}
            rightSectionPointerEvents="auto"
            rightSection={
              item.key ? (
                <ClearButton onClick={() => onChange(index, "", item.value)} />
              ) : null
            }
          />
          <TextInput
            placeholder="Value"
            value={item.value}
            onChange={(e) => onChange(index, item.key, e.currentTarget.value)}
            rightSectionPointerEvents="auto"
            rightSection={
              item.value ? (
                <ClearButton onClick={() => onChange(index, item.key, "")} />
              ) : null
            }
          />
          <RemoveIcon onClick={() => onRemove(index)}>X</RemoveIcon>
        </Group>
      ))}
    </>
  );
}

function RootRows({
  roots,
  onChange,
  onRemove,
}: {
  roots: Root[];
  onChange: (index: number, uri: string, name: string) => void;
  onRemove: (index: number) => void;
}) {
  /* v8 ignore next 3 -- unreachable: the caller guards with `length === 0`
     and renders an EmptyHint instead, so RootRows is only mounted with a
     non-empty list. */
  if (roots.length === 0) {
    return null;
  }

  return (
    <>
      {roots.map((root, index) => (
        <Group key={index} grow>
          <TextInput
            placeholder="URI (e.g. file:///path)"
            value={root.uri}
            onChange={(e) =>
              onChange(index, e.currentTarget.value, root.name ?? "")
            }
            rightSectionPointerEvents="auto"
            rightSection={
              root.uri ? (
                <ClearButton
                  onClick={() => onChange(index, "", root.name ?? "")}
                />
              ) : null
            }
          />
          <TextInput
            placeholder="Name (optional)"
            value={root.name ?? ""}
            onChange={(e) => onChange(index, root.uri, e.currentTarget.value)}
            rightSectionPointerEvents="auto"
            rightSection={
              root.name ? (
                <ClearButton onClick={() => onChange(index, root.uri, "")} />
              ) : null
            }
          />
          <RemoveIcon onClick={() => onRemove(index)}>X</RemoveIcon>
        </Group>
      ))}
    </>
  );
}

export function ServerSettingsForm({
  settings,
  serverType = "streamable-http",
  isStdio,
  expandedSections,
  onExpandedSectionsChange,
  onAddHeader,
  onRemoveHeader,
  onHeaderChange,
  onAddEnv,
  onRemoveEnv,
  onEnvChange,
  onCwdChange,
  onAddMetadata,
  onRemoveMetadata,
  onMetadataChange,
  onTimeoutChange,
  onAutoRefreshChange,
  onPaginatedListsChange,
  onMaxFetchRequestsChange,
  onProtocolEraChange,
  onModernLogLevelChange,
  onOAuthChange,
  onClearStoredOAuth,
  onAddRoot,
  onRemoveRoot,
  onRootChange,
}: ServerSettingsFormProps) {
  const oauthCapable = isOAuthCapableServerType(serverType);
  const handleMaxFetchRequestsChange = (value: number | string) => {
    if (typeof value === "number") {
      onMaxFetchRequestsChange(value);
      return;
    }
    // Mantine emits "" when the field is cleared. Don't coerce that to 0 — 0
    // means "unlimited", and since the value applies live on modal close,
    // clearing-to-retype-then-closing would silently switch the log to
    // unlimited. Keep the current value on an empty/NaN parse; reserve 0 for an
    // explicit numeric entry.
    const parsed = parseInt(value, 10);
    onMaxFetchRequestsChange(
      Number.isNaN(parsed) ? settings.maxFetchRequests : parsed,
    );
  };
  const handleTimeoutChange =
    (field: "connectionTimeout" | "requestTimeout" | "taskTtl") =>
    (value: number | string) => {
      const numValue =
        typeof value === "string" ? parseInt(value, 10) || 0 : value;
      onTimeoutChange(field, numValue);
    };

  function currentOAuth(): OAuthSettings {
    return {
      clientId: settings.oauthClientId ?? "",
      clientSecret: settings.oauthClientSecret ?? "",
      scopes: settings.oauthScopes ?? "",
      enterpriseManaged: settings.enterpriseManaged ?? false,
      onInsufficientScope: settings.oauthOnInsufficientScope,
    };
  }

  return (
    <Accordion
      multiple
      value={expandedSections}
      onChange={(value) =>
        onExpandedSectionsChange(value as ServerSettingsSection[])
      }
      variant="separated"
    >
      <Accordion.Item value="options">
        <Accordion.Control>Options</Accordion.Control>
        <Accordion.Panel>
          <Stack gap="md">
            <Select
              label="Protocol Era"
              description="Which MCP protocol era to negotiate with this server (independent of the transport). Legacy uses the 2025-11-25 initialize handshake; Auto probes server/discover and falls back to legacy; Modern pins the 2026-07-28 sessionless protocol. Defaults to Legacy — debugging tools should not auto-probe."
              data={PROTOCOL_ERA_OPTIONS}
              value={settings.protocolEra ?? DEFAULT_PROTOCOL_ERA}
              onChange={(value) => {
                // Select emits `string | null`; the null (cleared) case is
                // unreachable here — the field is not clearable and the value
                // always resolves to a known era.
                /* v8 ignore next -- Select never emits an out-of-range value */
                if (isProtocolEra(value)) onProtocolEraChange(value);
              }}
              allowDeselect={false}
            />
            <Select
              label="Log Level per Request"
              description="Modern-era only. On 2026-07-28 servers there is no logging/setLevel — the client opts into logs per request by stamping this level in each request's _meta, and logs arrive on the originating request's stream. Off requests no logs. Defaults to Debug so a modern connection surfaces server logs out of the box. Legacy servers ignore this and use Set Active Level."
              data={MODERN_LOG_LEVEL_OPTIONS}
              value={settings.modernLogLevel ?? DEFAULT_MODERN_LOG_LEVEL}
              onChange={(value) => {
                // Select emits `string | null`; not clearable, so the value
                // always resolves to a known option.
                /* v8 ignore next -- Select never emits an out-of-range value */
                if (isModernLogLevelValue(value)) onModernLogLevelChange(value);
              }}
              allowDeselect={false}
            />
            <Checkbox
              label="Auto Refresh on List Changed Notifications"
              description="When checked, tool/prompt/resource lists refresh automatically when the server sends a */list_changed notification. When unchecked, the list-changed indicator appears and you refresh on demand."
              checked={settings.autoRefreshOnListChanged ?? false}
              onChange={(e) => onAutoRefreshChange(e.currentTarget.checked)}
            />
            <Checkbox
              label="Fetch Lists One Page at a Time"
              description="When checked, the Tools, Resources, and Prompts lists load a single page and reveal a “Load next page” control instead of auto-loading every page. Useful defensively for servers with very large lists. The per-list sidebar toggle sets this too."
              checked={settings.paginatedLists ?? false}
              onChange={(e) => onPaginatedListsChange(e.currentTarget.checked)}
            />
            <NumberInput
              label="Network Log Size"
              description="Maximum number of HTTP requests kept in the Network log for this server. Older entries rotate out past this limit; a response body that arrives after its entry rotated out is dropped. Use 0 for unlimited (not recommended). Applies immediately to the active connection."
              min={0}
              step={100}
              value={settings.maxFetchRequests}
              onChange={handleMaxFetchRequestsChange}
            />
            {isStdio ? (
              <TextInput
                label="Working Directory"
                description="Directory the stdio server process is launched in. Leave empty to inherit the Inspector's working directory."
                placeholder="(inherit)"
                value={settings.cwd ?? ""}
                onChange={(e) => onCwdChange(e.currentTarget.value)}
                rightSectionPointerEvents="auto"
                rightSection={
                  settings.cwd ? (
                    <ClearButton onClick={() => onCwdChange("")} />
                  ) : null
                }
              />
            ) : null}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>

      {isStdio ? (
        <Accordion.Item value="environment">
          <Accordion.Control>Environment Variables</Accordion.Control>
          <Accordion.Panel>
            <Stack gap="md">
              <Group justify="space-between">
                <HintText>
                  Environment variables passed to the stdio server process.
                </HintText>
                <AddButton onClick={onAddEnv}>
                  + Add Environment Variable
                </AddButton>
              </Group>
              {settings.env.length === 0 ? (
                <EmptyHint>No environment variables configured</EmptyHint>
              ) : (
                <KeyValueRows
                  items={settings.env}
                  onChange={onEnvChange}
                  onRemove={onRemoveEnv}
                />
              )}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      ) : null}

      <Accordion.Item value="headers">
        <Accordion.Control>Custom Headers</Accordion.Control>
        <Accordion.Panel>
          <Stack gap="md">
            <Group justify="space-between">
              <HintText>
                Headers sent with every HTTP request to this server. If OAuth is
                configured below, the `Authorization` header is owned by the
                OAuth flow and any value set here is ignored.
              </HintText>
              <AddButton onClick={onAddHeader}>+ Add Header</AddButton>
            </Group>
            {settings.headers.length === 0 ? (
              <EmptyHint>No custom headers configured</EmptyHint>
            ) : (
              <KeyValueRows
                items={settings.headers}
                onChange={onHeaderChange}
                onRemove={onRemoveHeader}
              />
            )}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>

      <Accordion.Item value="metadata">
        <Accordion.Control>Request Metadata</Accordion.Control>
        <Accordion.Panel>
          <Stack gap="md">
            <Group justify="space-between">
              <HintText>
                Metadata sent with every MCP request (included in _meta field)
              </HintText>
              <AddButton onClick={onAddMetadata}>+ Add Metadata</AddButton>
            </Group>
            {settings.metadata.length === 0 ? (
              <EmptyHint>No request metadata configured</EmptyHint>
            ) : (
              <KeyValueRows
                items={settings.metadata}
                onChange={onMetadataChange}
                onRemove={onRemoveMetadata}
              />
            )}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>

      <Accordion.Item value="timeouts">
        <Accordion.Control>Timeouts</Accordion.Control>
        <Accordion.Panel>
          <Group>
            <NumberInput
              label="Connection Timeout"
              suffix=" ms"
              value={settings.connectionTimeout}
              onChange={handleTimeoutChange("connectionTimeout")}
            />
            <NumberInput
              label="Request Timeout"
              suffix=" ms"
              value={settings.requestTimeout}
              onChange={handleTimeoutChange("requestTimeout")}
            />
            <NumberInput
              label="Task TTL"
              suffix=" ms"
              min={1}
              value={settings.taskTtl}
              onChange={handleTimeoutChange("taskTtl")}
            />
          </Group>
        </Accordion.Panel>
      </Accordion.Item>

      <Accordion.Item value="roots">
        <Accordion.Control>Roots</Accordion.Control>
        <Accordion.Panel>
          <Stack gap="md">
            <Group justify="space-between">
              <HintText>
                Configure the root directories that the server can access. Each
                root needs a URI; the name is optional.
              </HintText>
              <AddButton onClick={onAddRoot}>+ Add Root</AddButton>
            </Group>
            {settings.roots.length === 0 ? (
              <EmptyHint>No roots configured</EmptyHint>
            ) : (
              <RootRows
                roots={settings.roots}
                onChange={onRootChange}
                onRemove={onRemoveRoot}
              />
            )}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>

      {oauthCapable ? (
        <Accordion.Item value="oauth">
          <Accordion.Control>OAuth Settings</Accordion.Control>
          <Accordion.Panel>
            <Stack gap="md">
              <Checkbox
                label="Enterprise-managed authorization"
                description="Connect via the configured enterprise IdP instead of interactive OAuth to the MCP authorization server. OAuth fields below are resource authorization server credentials."
                checked={settings.enterpriseManaged ?? false}
                onChange={(e) =>
                  onOAuthChange({
                    ...currentOAuth(),
                    enterpriseManaged: e.currentTarget.checked,
                  })
                }
              />
              <HintText>
                Pre-configure OAuth credentials for servers requiring
                authentication
              </HintText>
              <TextInput
                label="Client ID"
                value={settings.oauthClientId ?? ""}
                onChange={(e) =>
                  onOAuthChange({
                    ...currentOAuth(),
                    clientId: e.currentTarget.value,
                  })
                }
                rightSectionPointerEvents="auto"
                rightSection={
                  settings.oauthClientId ? (
                    <ClearButton
                      onClick={() =>
                        onOAuthChange({ ...currentOAuth(), clientId: "" })
                      }
                    />
                  ) : null
                }
              />
              <TextInput
                label="Client Secret"
                value={settings.oauthClientSecret ?? ""}
                type="password"
                onChange={(e) =>
                  onOAuthChange({
                    ...currentOAuth(),
                    clientSecret: e.currentTarget.value,
                  })
                }
                rightSectionPointerEvents="auto"
                rightSection={
                  settings.oauthClientSecret ? (
                    <ClearButton
                      onClick={() =>
                        onOAuthChange({ ...currentOAuth(), clientSecret: "" })
                      }
                    />
                  ) : null
                }
              />
              <TextInput
                label="Scopes"
                value={settings.oauthScopes ?? ""}
                onChange={(e) =>
                  onOAuthChange({
                    ...currentOAuth(),
                    scopes: e.currentTarget.value,
                  })
                }
                rightSectionPointerEvents="auto"
                rightSection={
                  settings.oauthScopes ? (
                    <ClearButton
                      onClick={() =>
                        onOAuthChange({ ...currentOAuth(), scopes: "" })
                      }
                    />
                  ) : null
                }
              />
              <Select
                label="Insufficient-scope response"
                description="On a 403 insufficient_scope challenge (SEP-2350): re-authorize with the accumulated scope union, or surface the error to you."
                data={[
                  {
                    value: "reauthorize",
                    label: "Re-authorize (union scopes)",
                  },
                  { value: "throw", label: "Throw (surface the error)" },
                ]}
                value={settings.oauthOnInsufficientScope ?? "reauthorize"}
                onChange={(value) =>
                  onOAuthChange({
                    ...currentOAuth(),
                    onInsufficientScope:
                      value === "throw" ? "throw" : "reauthorize",
                  })
                }
                allowDeselect={false}
              />
              {onClearStoredOAuth ? (
                <Flex align="flex-start" gap="sm" wrap="wrap">
                  <ClearStoredOAuthButton onClick={onClearStoredOAuth}>
                    Clear stored OAuth state
                  </ClearStoredOAuthButton>
                  <ClearStoredOAuthHint>
                    Removes stored tokens and client registration for this
                    server. Disconnects if this server is currently connected.
                  </ClearStoredOAuthHint>
                </Flex>
              ) : null}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      ) : null}
    </Accordion>
  );
}
