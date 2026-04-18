import { useEffect } from "react";
import { Badge, Button, Card, Group, Menu, Stack, Text } from "@mantine/core";
import type {
  ConnectionStatus,
  ServerType,
} from "@inspector/core/mcp/types.js";
import { ServerStatusIndicator } from "../../elements/ServerStatusIndicator/ServerStatusIndicator";
import { TransportBadge } from "../../elements/TransportBadge/TransportBadge";
import { ConnectionToggle } from "../../elements/ConnectionToggle/ConnectionToggle";
import { ContentViewer } from "../../elements/ContentViewer/ContentViewer";
import { InlineError } from "../../elements/InlineError/InlineError";

export interface ServerCardProps {
  name: string;
  version?: string;
  transport: ServerType;
  connectionMode: string;
  command: string;
  status: ConnectionStatus;
  retryCount?: number;
  error?: { message: string; details?: string };
  canTestClientFeatures: boolean;
  activeServer?: string;
  onSetActiveServer?: (name: string | undefined) => void;
  onToggleConnection: (connect: boolean) => void;
  onServerInfo: () => void;
  onSettings: () => void;
  onEdit: () => void;
  onClone: () => void;
  onRemove: () => void;
  onTestSampling?: () => void;
  onTestElicitationForm?: () => void;
  onTestElicitationUrl?: () => void;
  onConfigureRoots?: () => void;
  compact?: boolean;
}

const HeaderLeft = Group.withProps({
  gap: "sm",
});

const HeaderRight = Group.withProps({
  gap: "sm",
});

const ActionsRow = Group.withProps({
  gap: "xs",
});

const ServerName = Text.withProps({
  fw: 600,
  size: "lg",
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

export function ServerCard({
  name,
  version,
  transport,
  connectionMode,
  command,
  status,
  retryCount,
  error,
  canTestClientFeatures,
  activeServer,
  onSetActiveServer,
  onToggleConnection,
  onServerInfo,
  onSettings,
  onEdit,
  onClone,
  onRemove,
  onTestSampling,
  onTestElicitationForm,
  onTestElicitationUrl,
  onConfigureRoots,
  compact = false,
}: ServerCardProps) {
  const isThisConnecting = activeServer === name;
  const isDimmed = activeServer !== undefined && activeServer !== name;
  const displayStatus = isThisConnecting ? "connecting" : status;

  useEffect(() => {
    if (isThisConnecting) {
      onToggleConnection(true);
    }
  }, [isThisConnecting, onToggleConnection]);

  function handleToggle(connect: boolean) {
    if (connect && !activeServer) {
      onSetActiveServer?.(name);
    } else if (!connect && activeServer && activeServer === name) {
      onSetActiveServer?.(undefined);
      onToggleConnection(false);
    }
  }

  return (
    <Card
      withBorder
      padding="lg"
      variant={isDimmed ? "disabled" : undefined}
      {...(isDimmed ? { "aria-disabled": true, inert: true } : {})}
    >
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap">
          <HeaderLeft>
            <ServerName>{name}</ServerName>
            {version && <Badge variant="outline">{version}</Badge>}
          </HeaderLeft>
          <HeaderRight>
            <ServerStatusIndicator
              status={displayStatus}
              retryCount={retryCount}
            />
            <ConnectionToggle
              status={displayStatus}
              disabled={isDimmed}
              onConnect={() => handleToggle(true)}
              onDisconnect={() => handleToggle(false)}
            />
          </HeaderRight>
        </Group>

        {!compact && (
          <>
            <Group justify="space-between" mih={30}>
              <Group gap="sm">
                <TransportBadge transport={transport} />
                <ModeText>{connectionMode}</ModeText>
              </Group>
              {canTestClientFeatures && (
                <Menu>
                  <Menu.Target>
                    <SubtleButton>Test Client Features &#x25BE;</SubtleButton>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item onClick={onTestSampling}>
                      Simulate Sampling Request
                    </Menu.Item>
                    <Menu.Item onClick={onTestElicitationForm}>
                      Simulate Elicitation (Form)
                    </Menu.Item>
                    <Menu.Item onClick={onTestElicitationUrl}>
                      Simulate Elicitation (URL)
                    </Menu.Item>
                    <Menu.Item onClick={onConfigureRoots}>
                      Configure Roots
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              )}
            </Group>

            <ContentViewer block={{ type: "text", text: command }} copyable />

            {error && (
              <InlineError
                error={{
                  message: error.message,
                  data: error.details,
                }}
                retryCount={retryCount}
              />
            )}

            <Group justify="space-between">
              <ActionsRow>
                <SubtleButton onClick={onClone}>Clone</SubtleButton>
                <SubtleButton onClick={onEdit}>Edit</SubtleButton>
                <RemoveButton onClick={onRemove}>Remove</RemoveButton>
              </ActionsRow>
              <ActionsRow>
                <SubtleButton onClick={onServerInfo}>Server Info</SubtleButton>
                <SubtleButton onClick={onSettings}>Settings</SubtleButton>
              </ActionsRow>
            </Group>
          </>
        )}
      </Stack>
    </Card>
  );
}
