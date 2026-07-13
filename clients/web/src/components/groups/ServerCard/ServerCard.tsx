import { useEffect, useRef, type ReactNode } from "react";
import { Badge, Button, Card, Group, Stack, Text } from "@mantine/core";
import type {
  MCPServerConfig,
  ServerEntry,
  ServerType,
} from "@inspector/core/mcp/types.js";
import { ServerStatusIndicator } from "../../elements/ServerStatusIndicator/ServerStatusIndicator";
import { TransportBadge } from "../../elements/TransportBadge/TransportBadge";
import { ConnectionToggle } from "../../elements/ConnectionToggle/ConnectionToggle";
import { ContentViewer } from "../../elements/ContentViewer/ContentViewer";
import { FAILED_CARD_SCROLL_DELAY_MS } from "../../views/InspectorView/monitorColumnAnimation";

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
   * When true, the card is freshly added: it draws a green border to draw the
   * eye. Cleared by `onClearHighlight` on any click on the card.
   */
  highlighted?: boolean;
  /**
   * When true, this server's last connection attempt failed: the card draws a
   * red border to flag it (#1621). The parent clears this when another server
   * is connected or a new connection is attempted.
   */
  errored?: boolean;
  /**
   * Whether a highlighted card scrolls itself into view. When several cards are
   * highlighted at once (a batch import) only the first should scroll, so the
   * list jumps to the start of the batch rather than fighting over the viewport.
   * Defaults to true.
   */
  scrollOnHighlight?: boolean;
  /** Called when a highlighted card is clicked, to dismiss the green border. */
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
  // `color` drives the subtle hover/active tint; `c` overrides just the label
  // to the AA-compliant danger red (red.6 text alone fell under contrast).
  color: "red.6",
  c: "var(--inspector-danger-text)",
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
  errored = false,
  scrollOnHighlight = true,
  onClearHighlight,
}: ServerCardProps) {
  const isDimmed = activeServer !== undefined && activeServer !== id;
  const rootRef = useRef<HTMLDivElement>(null);

  // When freshly added, bring the card into view (it may be far down a long
  // list). Only the designated card scrolls (the first of a highlighted batch).
  useEffect(() => {
    if (highlighted && scrollOnHighlight) {
      rootRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlighted, scrollOnHighlight]);

  // Scroll the failed card into view on the disconnected→errored transition
  // (#1621), deferred past the monitoring sidebar's open (`FAILED_CARD_SCROLL_
  // DELAY_MS`, derived from the column's slide duration) so the grid reflow
  // settles before `scrollIntoView` measures the card. Guarded by a ref so a
  // re-render while still errored doesn't re-scroll and fight the user if they've
  // scrolled away.
  const wasErroredRef = useRef(errored);
  useEffect(() => {
    const justErrored = errored && !wasErroredRef.current;
    wasErroredRef.current = errored;
    if (!justErrored) return;
    const timer = setTimeout(() => {
      rootRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, FAILED_CARD_SCROLL_DELAY_MS);
    return () => clearTimeout(timer);
  }, [errored]);
  const transport = getTransport(config);
  const commandOrUrl = getCommandOrUrl(config);
  const version = info?.version;
  const protocolVersion =
    connection.status === "connected" ? connection.protocolVersion : undefined;

  // A dimmed card (another server is active) is inert, so the disabled variant
  // wins; otherwise a failed-connection card draws the red error border, then a
  // freshly-added card draws the highlighted green border.
  const variant = isDimmed
    ? "disabled"
    : errored
      ? "errored"
      : highlighted
        ? "highlighted"
        : undefined;

  return (
    <Card
      ref={rootRef}
      variant={variant}
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
              aria-label={`Connect or disconnect "${name}"`}
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
              wrap={false}
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
}
