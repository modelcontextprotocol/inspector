import { Badge, Button, Card, Group, Stack, Text } from "@mantine/core";
import type { Implementation } from "@modelcontextprotocol/sdk/types.js";
import type {
  ConnectionState,
  MCPServerConfig,
  ServerType,
} from "@inspector/core/mcp/types.js";
import { ServerStatusIndicator } from "../../elements/ServerStatusIndicator/ServerStatusIndicator";
import { TransportBadge } from "../../elements/TransportBadge/TransportBadge";
import { ConnectionToggle } from "../../elements/ConnectionToggle/ConnectionToggle";
import { ContentViewer } from "../../elements/ContentViewer/ContentViewer";
import { InlineError } from "../../elements/InlineError/InlineError";

export interface ServerCardProps {
  /** Stable unique identifier — the MCPConfig.mcpServers map key. */
  id: string;
  /** Display label shown in the card header. May or may not equal id. */
  name: string;
  config: MCPServerConfig;
  info?: Implementation;
  connection: ConnectionState;
  activeServer?: string;
  onToggleConnection: (id: string) => void;
  onServerInfo: (id: string) => void;
  onSettings: (id: string) => void;
  onEdit: (id: string) => void;
  onClone: (id: string) => void;
  onRemove: (id: string) => void;
  compact?: boolean;
}

const HeaderLeft = Group.withProps({
  gap: "sm",
  wrap: "nowrap",
  miw: 0,
  flex: 1,
});

const HeaderRight = Group.withProps({
  gap: "sm",
  wrap: "nowrap",
});

const ActionsRow = Group.withProps({
  gap: "xs",
});

const ServerName = Text.withProps({
  fw: 600,
  size: "lg",
  truncate: "end",
  miw: 0,
  flex: 1,
});

const ModeText = Text.withProps({
  size: "sm",
  c: "dimmed",
});

const SubtleButton = Button.withProps({
  variant: "subtle",
  size: "xs",
});

const RemoveButton = Button.withProps({
  variant: "subtle",
  size: "xs",
  color: "red.6",
});

function getTransport(config: MCPServerConfig): ServerType {
  return config.type ?? "stdio";
}

const TRANSPORT_DESCRIPTION: Record<ServerType, string> = {
  stdio: "Standard I/O",
  sse: "SSE (Server Sent Events) [deprecated]",
  "streamable-http": "Streamable HTTP",
};

function getCommandOrUrl(config: MCPServerConfig): string {
  if (config.type === "sse" || config.type === "streamable-http") {
    return config.url;
  }
  return config.command;
}

export function ServerCard({
  id,
  name,
  config,
  info,
  connection,
  activeServer,
  onToggleConnection,
  onServerInfo,
  onSettings,
  onEdit,
  onClone,
  onRemove,
  compact = false,
}: ServerCardProps) {
  const isDimmed = activeServer !== undefined && activeServer !== id;
  const transport = getTransport(config);
  const commandOrUrl = getCommandOrUrl(config);
  const version = info?.version;

  return (
    <Card
      withBorder
      padding="lg"
      variant={isDimmed ? "disabled" : undefined}
      {...(isDimmed ? { "aria-disabled": true, inert: true } : {})}
    >
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap">
          <HeaderLeft>
            <ServerName>{name}</ServerName>
          </HeaderLeft>
          <HeaderRight>
            <ServerStatusIndicator
              status={connection.status}
              retryCount={connection.retryCount}
            />
            <ConnectionToggle
              status={connection.status}
              disabled={isDimmed}
              onToggle={() => onToggleConnection(id)}
            />
          </HeaderRight>
        </Group>

        {!compact && (
          <>
            <Group gap="sm" mih={30}>
              {version && <Badge variant="outline">{version}</Badge>}
              <TransportBadge transport={transport} />
              <ModeText>{TRANSPORT_DESCRIPTION[transport]}</ModeText>
            </Group>

            <ContentViewer
              block={{ type: "text", text: commandOrUrl }}
              copyable
            />

            {connection.error && (
              <InlineError
                error={{
                  message: connection.error.message,
                  data: connection.error.details,
                }}
                retryCount={connection.retryCount}
              />
            )}

            <Group justify="space-between">
              <ActionsRow>
                <SubtleButton onClick={() => onClone(id)}>Clone</SubtleButton>
                <SubtleButton onClick={() => onEdit(id)}>Edit</SubtleButton>
                <RemoveButton onClick={() => onRemove(id)}>Remove</RemoveButton>
              </ActionsRow>
              <ActionsRow>
                <SubtleButton onClick={() => onServerInfo(id)}>
                  Server Info
                </SubtleButton>
                <SubtleButton onClick={() => onSettings(id)}>
                  Settings
                </SubtleButton>
              </ActionsRow>
            </Group>
          </>
        )}
      </Stack>
    </Card>
  );
}
