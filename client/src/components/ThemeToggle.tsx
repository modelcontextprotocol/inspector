import { ActionIcon, Menu, useMantineColorScheme } from '@mantine/core';
import { IconSun, IconMoon, IconDeviceDesktop } from '@tabler/icons-react';

export function ThemeToggle() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();

  // Resolve the actual theme for the icon display
  const isDark =
    colorScheme === 'dark' ||
    (colorScheme === 'auto' &&
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <Menu shadow="md" width={150}>
      <Menu.Target>
        <ActionIcon variant="subtle" size="lg" aria-label="Toggle theme">
          {isDark ? <IconMoon size={18} /> : <IconSun size={18} />}
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item
          leftSection={<IconSun size={14} />}
          onClick={() => setColorScheme('light')}
        >
          Light
        </Menu.Item>
        <Menu.Item
          leftSection={<IconMoon size={14} />}
          onClick={() => setColorScheme('dark')}
        >
          Dark
        </Menu.Item>
        <Menu.Item
          leftSection={<IconDeviceDesktop size={14} />}
          onClick={() => setColorScheme('auto')}
        >
          System
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
