import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import {
  AppShell,
  Group,
  Button,
  Menu,
  Badge,
  Text,
  UnstyledButton,
  Loader,
} from '@mantine/core';
import { IconPlugConnected, IconPlugConnectedX, IconAlertCircle } from '@tabler/icons-react';
import { ThemeToggle } from '../components/ThemeToggle';
import { useMcp } from '@/context';

export function AppLayout() {
  const navigate = useNavigate();
  const { connectionState, serverInfo, serverUrl, disconnect, isConnected } = useMcp();

  const navItems = [
    { label: 'Tools', path: '/tools' },
    { label: 'Resources', path: '/resources' },
    { label: 'Prompts', path: '/prompts' },
    { label: 'Logs', path: '/logs' },
    { label: 'Tasks', path: '/tasks' },
    { label: 'History', path: '/history' },
  ];

  // Get status badge based on connection state
  const getStatusBadge = () => {
    switch (connectionState) {
      case 'connected':
        return (
          <Badge size="sm" color="green" variant="dot" leftSection={<IconPlugConnected size={12} />}>
            Connected
          </Badge>
        );
      case 'connecting':
        return (
          <Badge size="sm" color="blue" variant="dot" leftSection={<Loader size={12} />}>
            Connecting...
          </Badge>
        );
      case 'error':
        return (
          <Badge size="sm" color="red" variant="dot" leftSection={<IconAlertCircle size={12} />}>
            Error
          </Badge>
        );
      default:
        return (
          <Badge size="sm" color="gray" variant="dot" leftSection={<IconPlugConnectedX size={12} />}>
            Disconnected
          </Badge>
        );
    }
  };

  const handleDisconnect = async () => {
    await disconnect();
    navigate('/');
  };

  // Get display name for server
  const serverName = serverInfo?.name || (serverUrl ? new URL(serverUrl).hostname : 'No Server');

  return (
    <AppShell header={{ height: 60 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          {/* Left side: Server dropdown and status */}
          <Group gap="md">
            <Menu shadow="md" width={200}>
              <Menu.Target>
                <UnstyledButton>
                  <Group gap="xs">
                    <Text fw={600}>{serverName}</Text>
                    <Text size="xs" c="dimmed">▼</Text>
                  </Group>
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item onClick={() => navigate('/')}>
                  Switch Server
                </Menu.Item>
                {serverInfo && (
                  <>
                    <Menu.Divider />
                    <Menu.Label>Server Info</Menu.Label>
                    <Menu.Item disabled>
                      <Text size="xs">Version: {serverInfo.version}</Text>
                    </Menu.Item>
                    {serverInfo.capabilities.tools && (
                      <Menu.Item disabled>
                        <Text size="xs">Tools: Supported</Text>
                      </Menu.Item>
                    )}
                    {serverInfo.capabilities.resources && (
                      <Menu.Item disabled>
                        <Text size="xs">Resources: Supported</Text>
                      </Menu.Item>
                    )}
                    {serverInfo.capabilities.prompts && (
                      <Menu.Item disabled>
                        <Text size="xs">Prompts: Supported</Text>
                      </Menu.Item>
                    )}
                  </>
                )}
              </Menu.Dropdown>
            </Menu>

            <Group gap="xs">
              {getStatusBadge()}
            </Group>
          </Group>

          {/* Center: Navigation */}
          <Group gap="xs">
            {navItems.map((item) => (
              <Button
                key={item.path}
                component={NavLink}
                to={item.path}
                variant="subtle"
                size="sm"
                style={({ isActive }: { isActive: boolean }) => ({
                  backgroundColor: isActive ? 'var(--mantine-color-default-hover)' : undefined,
                })}
              >
                {item.label}
              </Button>
            ))}
          </Group>

          {/* Right side: Theme toggle and Disconnect */}
          <Group gap="xs">
            <ThemeToggle />
            <Button
              variant="outline"
              color="red"
              size="sm"
              onClick={handleDisconnect}
              disabled={!isConnected}
            >
              Disconnect
            </Button>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
