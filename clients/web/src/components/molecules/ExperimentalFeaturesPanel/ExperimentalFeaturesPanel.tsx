import {
  ActionIcon,
  Alert,
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

export interface ExperimentalCapability {
  name: string;
  description?: string;
  methods?: string[];
}

export interface ClientExperimentalCapability {
  name: string;
  enabled: boolean;
}

export interface KeyValuePair {
  key: string;
  value: string;
}

export interface RequestHistoryItem {
  timestamp: string;
  method: string;
  status: string;
  durationMs: number;
}

export interface ExperimentalFeaturesPanelProps {
  serverCapabilities: ExperimentalCapability[];
  clientCapabilities: ClientExperimentalCapability[];
  requestJson: string;
  responseJson?: string;
  customHeaders: KeyValuePair[];
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

function formatMethods(methods: string[]): string {
  return `Methods: ${methods.join(", ")}`;
}

function formatDuration(ms: number): string {
  return `${ms}ms`;
}

export function ExperimentalFeaturesPanel({
  serverCapabilities,
  clientCapabilities,
  requestJson,
  responseJson,
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
  return (
    <Stack gap="md">
      <Alert color="yellow">
        These features are non-standard and may change or be removed.
      </Alert>

      <Title order={5}>Server Experimental Capabilities:</Title>

      {serverCapabilities.length === 0 ? (
        <Text c="dimmed">No experimental capabilities</Text>
      ) : (
        serverCapabilities.map((cap) => (
          <CapCard key={cap.name}>
            <Stack gap="xs">
              <Text fw={600}>{cap.name}</Text>
              {cap.description && <HintText>{cap.description}</HintText>}
              {cap.methods && cap.methods.length > 0 && (
                <MetaText>{formatMethods(cap.methods)}</MetaText>
              )}
              <Group>
                <CompactButton onClick={() => onTestCapability(cap.name)}>
                  Test →
                </CompactButton>
              </Group>
            </Stack>
          </CapCard>
        ))
      )}

      <Divider />

      <Title order={5}>Client Experimental Capabilities:</Title>

      {clientCapabilities.map((clientCap) => (
        <Checkbox
          key={clientCap.name}
          label={clientCap.name}
          checked={clientCap.enabled}
          onChange={(e) =>
            onToggleClientCapability(clientCap.name, e.currentTarget.checked)
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
        value={requestJson}
        onChange={(e) => onRequestChange(e.currentTarget.value)}
        autosize
        minRows={6}
      />

      <Button onClick={onSendRequest}>Send Request</Button>

      {responseJson && (
        <>
          <Textarea
            label="Response"
            ff="monospace"
            value={responseJson}
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
                  <Table.Td>{item.timestamp}</Table.Td>
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
