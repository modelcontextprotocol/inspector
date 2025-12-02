import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  AppShell,
  Group,
  Button,
  Menu,
  Badge,
  Text,
  UnstyledButton,
} from '@mantine/core';

// Fallback server data for direct navigation
const fallbackServer = {
  name: 'Unknown Server',
  status: 'connected' as const,
  latency: 0,
};

export function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const server = location.state?.server || fallbackServer;

  const navItems = [
    { label: 'Tools', path: '/tools' },
    { label: 'Resources', path: '/resources' },
    { label: 'Prompts', path: '/prompts' },
    { label: 'Logs', path: '/logs' },
    { label: 'Tasks', path: '/tasks' },
    { label: 'History', path: '/history' },
  ];

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
                    <Text fw={600}>{server.name}</Text>
                    <Text size="xs" c="dimmed">▼</Text>
                  </Group>
                </UnstyledButton>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item onClick={() => navigate('/')}>
                  Switch Server
                </Menu.Item>
                <Menu.Item>Server Info</Menu.Item>
              </Menu.Dropdown>
            </Menu>

            <Group gap="xs">
              <Badge
                size="sm"
                color={server.status === 'connected' ? 'green' : 'gray'}
                variant="dot"
              >
                Connected
              </Badge>
              <Text size="xs" c="dimmed">
                ({server.latency || 0}ms)
              </Text>
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
                  backgroundColor: isActive ? 'var(--mantine-color-dark-6)' : undefined,
                })}
              >
                {item.label}
              </Button>
            ))}
          </Group>

          {/* Right side: Disconnect */}
          <Button
            variant="outline"
            color="red"
            size="sm"
            onClick={() => navigate('/')}
          >
            Disconnect
          </Button>
        </Group>
      </AppShell.Header>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
