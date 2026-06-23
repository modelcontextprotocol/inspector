import { useEffect, useRef, type ReactNode } from "react";
import { Badge, Button, Card, Group, Stack, Text } from "@mantine/core";
import { BorderAnimate } from "@gfazioli/mantine-border-animate";
import type {
  MCPServerConfig,
  ServerEntry,
  ServerType,
} from "@inspector/core/mcp/types.js";
import { ServerStatusIndicator } from "../../elements/ServerStatusIndicator/ServerStatusIndicator";
import { TransportBadge } from "../../elements/TransportBadge/TransportBadge";
import { ConnectionToggle } from "../../elements/ConnectionToggle/ConnectionToggle";
import { ContentViewer } from "../../elements/ContentViewer/ContentViewer";

export interface ServerCardProps extends ServerEntry {
  activeServer?: string;
  onToggleConnection: (id: string) => void;
  onConnectionInfo: (id: string) => void;
  onSettings: (id: string) => void;
  onEdit: (id: string) => void;
  onClone: (id: string) => void;
  onRemove: (id: string) => void;
  compact?: boolean;
  /**
   * When false (read-only session), the catalog mutation actions
   * (Clone / Edit / Remove / Settings) are hidden; connect and Connection Info
   * remain. Defaults to true.
   */
  writable?: boolean;
  /**
   * Optional drag-handle affordance rendered at the start of the card header,
   * before the server name. Supplied by the sortable wrapper
   * (`SortableServerCard`); omitted when the card is rendered outside a reorder
   * context, so the card stays a dumb display component with no knowledge of
   * drag-and-drop.
   */
  dragHandle?: ReactNode;
  /**
   * When true, the card is freshly added: it scrolls into view and draws an
   * animated border (Mantine Border Animate) to draw the eye. Cleared by
   * `onClearHighlight` on any click on the card.
   */
  highlighted?: boolean;
  /** Called when a highlighted card is clicked, to dismiss the animated border. */
  onClearHighlight?: () => void;
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

const ProtocolText = Text.withProps({
  size: "sm",
  c: "dimmed",
  ml: "auto",
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
  // Show the full argv for stdio so the card displays the same thing
  // that gets spawned. Otherwise a `command: "npx", args: ["-y", "pkg"]`
  // config renders as just "npx", which is misleading.
  const args = config.args ?? [];
  return args.length > 0
    ? `${config.command} ${args.join(" ")}`
    : config.command;
}

export function ServerCard({
  id,
  name,
  config,
  info,
  connection,
  activeServer,
  onToggleConnection,
  onConnectionInfo,
  onSettings,
  onEdit,
  onClone,
  onRemove,
  compact = false,
  writable = true,
  dragHandle,
  highlighted = false,
  onClearHighlight,
}: ServerCardProps) {
  const isDimmed = activeServer !== undefined && activeServer !== id;
  const rootRef = useRef<HTMLDivElement>(null);

  // When freshly added, bring the card into view (it may be far down a long
  // list). Fires on the false→true transition only.
  useEffect(() => {
    if (highlighted) {
      rootRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlighted]);
  const transport = getTransport(config);
  const commandOrUrl = getCommandOrUrl(config);
  const version = info?.version;
  const protocolVersion =
    connection.status === "connected" ? connection.protocolVersion : undefined;

  const card = (
    <Card
      ref={rootRef}
      withBorder
      padding="lg"
      // BorderAnimate's wrapper is display:flex, so the card must stretch to
      // fill it — otherwise the card shrinks to content width while the
      // animated border spans the full grid cell.
      w="100%"
      variant={isDimmed ? "disabled" : undefined}
      onClick={highlighted ? onClearHighlight : undefined}
      {...(isDimmed ? { "aria-disabled": true, inert: true } : {})}
    >
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap">
          <HeaderLeft>
            {dragHandle}
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
              {protocolVersion && (
                <ProtocolText>MCP {protocolVersion}</ProtocolText>
              )}
            </Group>

            <ContentViewer
              block={{ type: "text", text: commandOrUrl }}
              copyable
            />

            <Group justify="space-between">
              <ActionsRow>
                {writable && (
                  <>
                    <SubtleButton onClick={() => onClone(id)}>
                      Clone
                    </SubtleButton>
                    <SubtleButton onClick={() => onEdit(id)}>Edit</SubtleButton>
                    <RemoveButton onClick={() => onRemove(id)}>
                      Remove
                    </RemoveButton>
                  </>
                )}
              </ActionsRow>
              <ActionsRow>
                {connection.status === "connected" && (
                  <SubtleButton onClick={() => onConnectionInfo(id)}>
                    Connection Info
                  </SubtleButton>
                )}
                {writable && (
                  <SubtleButton onClick={() => onSettings(id)}>
                    Settings
                  </SubtleButton>
                )}
              </ActionsRow>
            </Group>
          </>
        )}
      </Stack>
    </Card>
  );

  // Always render the wrapper and toggle `show`/`animate` rather than
  // conditionally wrapping — swapping the element type on clear would remount
  // the card (and its connect toggle / buttons), swallowing the click that
  // triggered the clear.
  return (
    <BorderAnimate
      show={highlighted}
      animate={highlighted}
      radius="md"
      w="100%"
    >
      {card}
    </BorderAnimate>
  );
}
