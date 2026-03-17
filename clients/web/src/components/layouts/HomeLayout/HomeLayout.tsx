import type { ReactNode } from 'react';
import { ActionIcon, AppShell, Group, Title, useComputedColorScheme } from '@mantine/core';

export interface HomeLayoutProps {
  children: ReactNode;
  onToggleTheme: () => void;
}

export function HomeLayout({ children, onToggleTheme }: HomeLayoutProps) {
  const colorScheme = useComputedColorScheme();

  return (
    <AppShell header={{ height: 60 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Title order={2}>MCP Inspector</Title>
          <ActionIcon
            variant="default"
            size="lg"
            aria-label="Toggle color scheme"
            onClick={onToggleTheme}
          >
            {colorScheme === 'dark' ? '\u2600' : '\u263E'}
          </ActionIcon>
        </Group>
      </AppShell.Header>
      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  );
}
