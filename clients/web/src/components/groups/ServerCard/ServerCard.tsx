import { Badge, Button, Card, Group, Stack, Text } from "@mantine/core";
import { useEffect, useState } from "react";
import type {
  MCPServerConfig,
  ServerEntry,
  ServerType,
} from "@inspector/core/mcp/types.js";
import { ServerStatusIndicator } from "../../elements/ServerStatusIndicator/ServerStatusIndicator";
import { TransportBadge } from "../../elements/TransportBadge/TransportBadge";
import { ConnectionToggle } from "../../elements/ConnectionToggle/ConnectionToggle";
import { ContentViewer } from "../../elements/ContentViewer/ContentViewer";
import { InlineError } from "../../elements/InlineError/InlineError";

const ERROR_AUTO_DISMISS_MS = 5000;

export interface ServerCardProps extends ServerEntry {
  activeServer?: string;
  onToggleConnection: (id: string) => void;
  onConnectionInfo: (id: string) => void;
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
}: ServerCardProps) {
  const isDimmed = activeServer !== undefined && activeServer !== id;
  const transport = getTransport(config);
  const commandOrUrl = getCommandOrUrl(config);
  const version = info?.version;

  // Visibility for the InlineError alert. Owned here (not InlineError)
  // so the slide-up exit animation runs whether the timer fires OR the
  // parent removes `connection.error` (e.g. a successful reconnect).
  // `lastError` keeps the message painted during the exit animation —
  // without it, swapping connection.error to undefined would blank the
  // alert content the moment the Transition starts running. The setState
  // in render is the React-blessed pattern for "remember the previous
  // value of a prop"; gated on message inequality so we never schedule
  // an infinite update.
  const errorMessage = connection.error?.message;
  const [dismissedMessage, setDismissedMessage] = useState<string | undefined>(
    undefined,
  );
  const [lastError, setLastError] = useState<
    { message: string; data?: unknown } | undefined
  >(undefined);
  if (connection.error && connection.error.message !== lastError?.message) {
    setLastError({
      message: connection.error.message,
      data: connection.error.details,
    });
  }
  const errorMounted =
    errorMessage !== undefined && errorMessage !== dismissedMessage;

  useEffect(() => {
    if (!errorMessage) return;
    const timer = setTimeout(
      () => setDismissedMessage(errorMessage),
      ERROR_AUTO_DISMISS_MS,
    );
    return () => clearTimeout(timer);
  }, [errorMessage]);

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

            {lastError && (
              <InlineError
                error={lastError}
                retryCount={connection.retryCount}
                mounted={errorMounted}
              />
            )}

            <Group justify="space-between">
              <ActionsRow>
                <SubtleButton onClick={() => onClone(id)}>Clone</SubtleButton>
                <SubtleButton onClick={() => onEdit(id)}>Edit</SubtleButton>
                <RemoveButton onClick={() => onRemove(id)}>Remove</RemoveButton>
              </ActionsRow>
              <ActionsRow>
                {connection.status === "connected" && (
                  <SubtleButton onClick={() => onConnectionInfo(id)}>
                    Connection Info
                  </SubtleButton>
                )}
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
