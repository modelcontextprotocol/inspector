import type { ReactNode } from "react";
import { ActionIcon, AppShell, Button, Group, Tabs, Text } from "@mantine/core";
import { useComputedColorScheme } from "@mantine/core";
import { StatusIndicator } from "../../atoms/StatusIndicator/StatusIndicator";

export interface ConnectedLayoutProps {
  serverName: string;
  status: "connected" | "connecting" | "failed";
  latencyMs?: number;
  activeTab: string;
  availableTabs: string[];
  onTabChange: (tab: string) => void;
  onDisconnect: () => void;
  onToggleTheme: () => void;
  children: ReactNode;
}

const ServerName = Text.withProps({
  fw: 600,
  size: "lg",
});

export function ConnectedLayout({
  serverName,
  status,
  latencyMs,
  activeTab,
  availableTabs,
  onTabChange,
  onDisconnect,
  onToggleTheme,
  children,
}: ConnectedLayoutProps) {
  const colorScheme = useComputedColorScheme();

  return (
    <AppShell header={{ height: 60 }} padding="md">
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="md" wrap="nowrap">
            <ServerName>{serverName}</ServerName>
            <StatusIndicator status={status} latencyMs={latencyMs} />
          </Group>

          <Tabs
            value={activeTab}
            onChange={(value) => value && onTabChange(value)}
            variant="default"
          >
            <Tabs.List>
              {availableTabs.map((tab) => (
                <Tabs.Tab key={tab} value={tab}>
                  {tab}
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs>

          <Group gap="sm">
            <ActionIcon
              variant="default"
              size="lg"
              aria-label="Toggle color scheme"
              onClick={onToggleTheme}
            >
              {colorScheme === "dark" ? "\u2600" : "\u263E"}
            </ActionIcon>
            <Button
              variant="outline"
              color="red"
              size="sm"
              onClick={onDisconnect}
            >
              Disconnect
            </Button>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  );
}
