import {
  Badge,
  Button,
  Card,
  Group,
  Menu,
  Stack,
  Text,
} from "@mantine/core";
import { StatusIndicator } from "../../atoms/StatusIndicator/StatusIndicator";
import { TransportBadge } from "../../atoms/TransportBadge/TransportBadge";
import { ConnectionToggle } from "../../atoms/ConnectionToggle/ConnectionToggle";
import { ContentViewer } from "../../atoms/ContentViewer/ContentViewer";
import { InlineError } from "../../atoms/InlineError/InlineError";

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
}: ServerCardProps) {
  const isConnected = status === "connected";
  const isConnecting = status === "connecting";

  return (
    <Card withBorder padding="lg">
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap">
          <HeaderLeft>
            <Text fw={600} size="lg">
              {name}
            </Text>
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

        <Group gap="sm">
          <TransportBadge transport={transport} />
          <Text size="sm" c="dimmed">
            {connectionMode}
          </Text>
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
            <Button variant="subtle" size="xs" onClick={onClone}>
              Clone
            </Button>
            <Button variant="subtle" size="xs" onClick={onEdit}>
              Edit
            </Button>
            <Button variant="transparent" size="xs" color="red" onClick={onRemove}>
              Remove
            </Button>
          </ActionsRow>
          <ActionsRow>
            <Button variant="subtle" size="xs" onClick={onServerInfo}>
              Server Info
            </Button>
            <Button variant="subtle" size="xs" onClick={onSettings}>
              Settings
            </Button>
            {canTestClientFeatures && (
              <Menu>
                <Menu.Target>
                  <Button variant="subtle" size="xs">
                    Test Client Features &#x25BE;
                  </Button>
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
      </Stack>
    </Card>
  );
}
