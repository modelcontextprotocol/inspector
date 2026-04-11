import {
  Accordion,
  ActionIcon,
  Button,
  Group,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";

export interface KeyValuePair {
  key: string;
  value: string;
}

export type ServerSettingsSection =
  | "connectionMode"
  | "headers"
  | "metadata"
  | "timeouts"
  | "oauth";

export interface ServerSettingsFormProps {
  connectionMode: "proxy" | "direct";
  headers: KeyValuePair[];
  metadata: KeyValuePair[];
  connectionTimeout: number;
  requestTimeout: number;
  oauthClientId?: string;
  oauthClientSecret?: string;
  oauthScopes?: string;
  expandedSections: ServerSettingsSection[];
  onExpandedSectionsChange: (sections: ServerSettingsSection[]) => void;
  onConnectionModeChange: (mode: string) => void;
  onAddHeader: () => void;
  onRemoveHeader: (index: number) => void;
  onHeaderChange: (index: number, key: string, value: string) => void;
  onAddMetadata: () => void;
  onRemoveMetadata: (index: number) => void;
  onMetadataChange: (index: number, key: string, value: string) => void;
  onTimeoutChange: (field: string, value: number) => void;
  onOAuthChange: (field: string, value: string) => void;
}

const CONNECTION_MODE_OPTIONS = [
  { value: "proxy", label: "Via Proxy" },
  { value: "direct", label: "Direct" },
];

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
  items: KeyValuePair[];
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
          />
          <TextInput
            placeholder="Value"
            value={item.value}
            onChange={(e) => onChange(index, item.key, e.currentTarget.value)}
          />
          <RemoveIcon onClick={() => onRemove(index)}>X</RemoveIcon>
        </Group>
      ))}
    </>
  );
}

export function ServerSettingsForm({
  connectionMode,
  headers,
  metadata,
  connectionTimeout,
  requestTimeout,
  oauthClientId,
  oauthClientSecret,
  oauthScopes,
  expandedSections,
  onExpandedSectionsChange,
  onConnectionModeChange,
  onAddHeader,
  onRemoveHeader,
  onHeaderChange,
  onAddMetadata,
  onRemoveMetadata,
  onMetadataChange,
  onTimeoutChange,
  onOAuthChange,
}: ServerSettingsFormProps) {
  const handleTimeoutChange = (field: string) => (value: number | string) => {
    const numValue =
      typeof value === "string" ? parseInt(value, 10) || 0 : value;
    onTimeoutChange(field, numValue);
  };

  return (
    <Accordion
      multiple
      value={expandedSections}
      onChange={(value) =>
        onExpandedSectionsChange(value as ServerSettingsSection[])
      }
      variant="separated"
    >
      <Accordion.Item value="connectionMode">
        <Accordion.Control>Connection Mode</Accordion.Control>
        <Accordion.Panel>
          <Select
            data={CONNECTION_MODE_OPTIONS}
            value={connectionMode}
            onChange={(value) => {
              if (value) onConnectionModeChange(value);
            }}
            description={
              connectionMode === "proxy"
                ? "Route through inspector proxy (required for STDIO)"
                : undefined
            }
          />
        </Accordion.Panel>
      </Accordion.Item>

      <Accordion.Item value="headers">
        <Accordion.Control>Custom Headers</Accordion.Control>
        <Accordion.Panel>
          <Stack gap="md">
            <Group justify="space-between">
              <HintText>
                Headers sent with every HTTP request to this server
              </HintText>
              <AddButton onClick={onAddHeader}>+ Add Header</AddButton>
            </Group>
            {headers.length === 0 ? (
              <EmptyHint>No custom headers configured</EmptyHint>
            ) : (
              <KeyValueRows
                items={headers}
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
            {metadata.length === 0 ? (
              <EmptyHint>No request metadata configured</EmptyHint>
            ) : (
              <KeyValueRows
                items={metadata}
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
              value={connectionTimeout}
              onChange={handleTimeoutChange("connectionTimeout")}
            />
            <NumberInput
              label="Request Timeout"
              suffix=" ms"
              value={requestTimeout}
              onChange={handleTimeoutChange("requestTimeout")}
            />
          </Group>
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
              value={oauthClientId ?? ""}
              onChange={(e) => onOAuthChange("clientId", e.currentTarget.value)}
            />
            <TextInput
              label="Client Secret"
              value={oauthClientSecret ?? ""}
              type="password"
              onChange={(e) =>
                onOAuthChange("clientSecret", e.currentTarget.value)
              }
            />
            <TextInput
              label="Scopes"
              value={oauthScopes ?? ""}
              onChange={(e) => onOAuthChange("scopes", e.currentTarget.value)}
            />
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
