import { Badge, Button, Card, Group, Menu, Stack, Text } from "@mantine/core";
import { StatusIndicator } from "../../elements/StatusIndicator/StatusIndicator";
import { TransportBadge } from "../../elements/TransportBadge/TransportBadge";
import { ConnectionToggle } from "../../elements/ConnectionToggle/ConnectionToggle";
import { ContentViewer } from "../../elements/ContentViewer/ContentViewer";
import { InlineError } from "../../elements/InlineError/InlineError";

export interface ServerCardProps {
  name: string;
  version?: string;
  transport: "stdio" | "http";
  connectionMode: string;
  command: string;
  status: "connected" | "connecting" | "disconnected" | "failed";
  retryCount?: number;
  error?: { message: string; details?: string };
  canTestClientFeatures: boolean;
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
  const isConnected = status === "connected";
  const isConnecting = status === "connecting";

  return (
    <Card withBorder padding="lg">
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap">
          <HeaderLeft>
            <ServerName>{name}</ServerName>
            {version && <Badge variant="outline">{version}</Badge>}
          </HeaderLeft>
          <HeaderRight>
            <StatusIndicator status={status} retryCount={retryCount} />
            <ConnectionToggle
              checked={isConnected}
              loading={isConnecting}
              disabled={false}
              onChange={onToggleConnection}
            />
          </HeaderRight>
        </Group>

        {!compact && (
          <>
            <Group gap="sm">
              <TransportBadge transport={transport} />
              <ModeText>{connectionMode}</ModeText>
            </Group>

            <ContentViewer type="text" content={command} copyable />

            {error && (
              <InlineError
                message={error.message}
                details={error.details}
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
              </ActionsRow>
            </Group>
          </>
        )}
      </Stack>
    </Card>
  );
}
