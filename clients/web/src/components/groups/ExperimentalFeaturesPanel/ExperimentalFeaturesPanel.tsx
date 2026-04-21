import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Divider,
  Group,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from "@mantine/core";
import type {
  JSONRPCErrorResponse,
  JSONRPCResponse,
  ServerCapabilities,
} from "@modelcontextprotocol/sdk/types.js";

export interface ClientExperimentalToggle {
  name: string;
  enabled: boolean;
}

export interface HeaderPair {
  key: string;
  value: string;
}

export interface RequestHistoryItem {
  timestamp: Date;
  method: string;
  status: string;
  durationMs: number;
}

export interface ExperimentalFeaturesPanelProps {
  serverExperimental: ServerCapabilities["experimental"];
  clientToggles: ClientExperimentalToggle[];
  requestDraft: string;
  response?: JSONRPCResponse | JSONRPCErrorResponse;
  customHeaders: HeaderPair[];
  requestHistory: RequestHistoryItem[];
  onToggleClientCapability: (name: string, enabled: boolean) => void;
  onRequestChange: (json: string) => void;
  onSendRequest: () => void;
  onAddHeader: () => void;
  onRemoveHeader: (index: number) => void;
  onHeaderChange: (index: number, key: string, value: string) => void;
  onCopyResponse: () => void;
  onTestCapability: (name: string) => void;
}

const HintText = Text.withProps({
  size: "sm",
  c: "dimmed",
});

const MetaText = Text.withProps({
  size: "xs",
  c: "dimmed",
});

const CapCard = Card.withProps({
  withBorder: true,
  p: "sm",
});

const CompactButton = Button.withProps({
  size: "xs",
  variant: "light",
});

const RemoveIcon = ActionIcon.withProps({
  variant: "light",
  color: "red",
});

function formatDuration(ms: number): string {
  return `${ms}ms`;
}

function formatTimestamp(date: Date): string {
  return date.toLocaleString();
}

function formatResponse(
  response: JSONRPCResponse | JSONRPCErrorResponse,
): string {
  return JSON.stringify(response, null, 2);
}

function isErrorResponse(
  response: JSONRPCResponse | JSONRPCErrorResponse,
): response is JSONRPCErrorResponse {
  return "error" in response;
}

function getCapabilityEntries(
  experimental: ServerCapabilities["experimental"],
): [string, object][] {
  if (!experimental) return [];
  return Object.entries(experimental);
}

function getCapabilityDescription(value: object): string | undefined {
  if ("description" in value && typeof value.description === "string") {
    return value.description;
  }
  return undefined;
}

function getCapabilityMethods(value: object): string[] | undefined {
  if (
    "methods" in value &&
    Array.isArray(value.methods) &&
    value.methods.every((m: unknown) => typeof m === "string")
  ) {
    return value.methods as string[];
  }
  return undefined;
}

function formatMethods(methods: string[]): string {
  return `Methods: ${methods.join(", ")}`;
}

export function ExperimentalFeaturesPanel({
  serverExperimental,
  clientToggles,
  requestDraft,
  response,
  customHeaders,
  requestHistory,
  onToggleClientCapability,
  onRequestChange,
  onSendRequest,
  onAddHeader,
  onRemoveHeader,
  onHeaderChange,
  onCopyResponse,
  onTestCapability,
}: ExperimentalFeaturesPanelProps) {
  const serverEntries = getCapabilityEntries(serverExperimental);

  return (
    <Stack gap="md">
      <Alert color="yellow">
        These features are non-standard and may change or be removed.
      </Alert>

      <Title order={5}>Server Experimental Capabilities:</Title>

      {serverEntries.length === 0 ? (
        <Text c="dimmed">No experimental capabilities</Text>
      ) : (
        serverEntries.map(([name, value]) => {
          const description = getCapabilityDescription(value);
          const methods = getCapabilityMethods(value);
          return (
            <CapCard key={name}>
              <Stack gap="xs">
                <Text fw={600}>{name}</Text>
                {description && <HintText>{description}</HintText>}
                {methods && methods.length > 0 && (
                  <MetaText>{formatMethods(methods)}</MetaText>
                )}
                <Group>
                  <CompactButton onClick={() => onTestCapability(name)}>
                    Test →
                  </CompactButton>
                </Group>
              </Stack>
            </CapCard>
          );
        })
      )}

      <Divider />

      <Title order={5}>Client Experimental Capabilities:</Title>

      {clientToggles.map((toggle) => (
        <Checkbox
          key={toggle.name}
          label={toggle.name}
          checked={toggle.enabled}
          onChange={(e) =>
            onToggleClientCapability(toggle.name, e.currentTarget.checked)
          }
        />
      ))}

      <Divider />

      <Title order={5}>Advanced JSON-RPC Tester</Title>

      <HintText>Send raw JSON-RPC requests to test ANY method</HintText>

      {customHeaders.map((header, index) => (
        <Group key={index}>
          <TextInput
            placeholder="Header name"
            value={header.key}
            onChange={(e) =>
              onHeaderChange(index, e.currentTarget.value, header.value)
            }
          />
          <TextInput
            placeholder="Header value"
            value={header.value}
            onChange={(e) =>
              onHeaderChange(index, header.key, e.currentTarget.value)
            }
          />
          <RemoveIcon onClick={() => onRemoveHeader(index)}>
            <Text size="xs">✕</Text>
          </RemoveIcon>
        </Group>
      ))}

      <Group>
        <CompactButton onClick={onAddHeader}>+ Add Header</CompactButton>
      </Group>

      <Textarea
        label="Request"
        ff="monospace"
        value={requestDraft}
        onChange={(e) => onRequestChange(e.currentTarget.value)}
        autosize
        minRows={6}
      />

      <Button onClick={onSendRequest}>Send Request</Button>

      {response && (
        <>
          <Group gap="xs">
            <Text fw={500} size="sm">
              Response
            </Text>
            {isErrorResponse(response) && (
              <Badge color="red" size="sm">
                Error
              </Badge>
            )}
          </Group>
          <Textarea
            ff="monospace"
            value={formatResponse(response)}
            readOnly
            autosize
            minRows={4}
          />
          <Group>
            <CompactButton onClick={onCopyResponse}>Copy</CompactButton>
          </Group>
        </>
      )}

      {requestHistory.length > 0 && (
        <>
          <Title order={5}>Request History:</Title>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Timestamp</Table.Th>
                <Table.Th>Method</Table.Th>
                <Table.Th>Status</Table.Th>
                <Table.Th>Duration</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {requestHistory.map((item, index) => (
                <Table.Tr key={index}>
                  <Table.Td>{formatTimestamp(item.timestamp)}</Table.Td>
                  <Table.Td>{item.method}</Table.Td>
                  <Table.Td>{item.status}</Table.Td>
                  <Table.Td>{formatDuration(item.durationMs)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </>
      )}
    </Stack>
  );
}
