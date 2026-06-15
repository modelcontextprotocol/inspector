import {
  Accordion,
  ActionIcon,
  Button,
  Checkbox,
  Group,
  NumberInput,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { ClearButton } from "../../elements/ClearButton/ClearButton";
import type {
  InspectorServerSettings,
  OAuthSettings,
} from "@inspector/core/mcp/types.js";
import type { Root } from "@modelcontextprotocol/sdk/types.js";

export type ServerSettingsSection =
  | "options"
  | "headers"
  | "metadata"
  | "timeouts"
  | "oauth"
  | "roots";

export interface ServerSettingsFormProps {
  settings: InspectorServerSettings;
  expandedSections: ServerSettingsSection[];
  onExpandedSectionsChange: (sections: ServerSettingsSection[]) => void;
  onAddHeader: () => void;
  onRemoveHeader: (index: number) => void;
  onHeaderChange: (index: number, key: string, value: string) => void;
  onAddMetadata: () => void;
  onRemoveMetadata: (index: number) => void;
  onMetadataChange: (index: number, key: string, value: string) => void;
  onTimeoutChange: (
    field: "connectionTimeout" | "requestTimeout" | "taskTtl",
    value: number,
  ) => void;
  onAutoRefreshChange: (value: boolean) => void;
  onMaxFetchRequestsChange: (value: number) => void;
  onOAuthChange: (oauth: OAuthSettings) => void;
  onAddRoot: () => void;
  onRemoveRoot: (index: number) => void;
  onRootChange: (index: number, uri: string, name: string) => void;
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

function KeyValueRows({
  items,
  onChange,
  onRemove,
}: {
  items: { key: string; value: string }[];
  onChange: (index: number, key: string, value: string) => void;
  onRemove: (index: number) => void;
}) {
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
  expandedSections,
  onExpandedSectionsChange,
  onAddHeader,
  onRemoveHeader,
  onHeaderChange,
  onAddMetadata,
  onRemoveMetadata,
  onMetadataChange,
  onTimeoutChange,
  onAutoRefreshChange,
  onMaxFetchRequestsChange,
  onOAuthChange,
  onAddRoot,
  onRemoveRoot,
  onRootChange,
}: ServerSettingsFormProps) {
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
            <Checkbox
              label="Auto Refresh on List Changed Notifications"
              description="When checked, tool/prompt/resource lists refresh automatically when the server sends a */list_changed notification. When unchecked, the list-changed indicator appears and you refresh on demand."
              checked={settings.autoRefreshOnListChanged ?? false}
              onChange={(e) => onAutoRefreshChange(e.currentTarget.checked)}
            />
            <NumberInput
              label="Network Log Size"
              description="Maximum number of HTTP requests kept in the Network log for this server. Older entries rotate out past this limit; a response body that arrives after its entry rotated out is dropped. Use 0 for unlimited (not recommended). Applies immediately to the active connection."
              min={0}
              step={100}
              value={settings.maxFetchRequests}
              onChange={handleMaxFetchRequestsChange}
            />
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>

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

      <Accordion.Item value="oauth">
        <Accordion.Control>OAuth Settings</Accordion.Control>
        <Accordion.Panel>
          <Stack gap="md">
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
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
