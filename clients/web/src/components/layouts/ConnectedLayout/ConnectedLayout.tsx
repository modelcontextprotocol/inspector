import type { ReactNode } from "react";
import { ActionIcon, AppShell, Button, Group, Image, SegmentedControl, Text } from "@mantine/core";
import { useComputedColorScheme } from "@mantine/core";
import { StatusIndicator } from "../../atoms/StatusIndicator/StatusIndicator";
import mcpLogo from "../../../theme/assets/MCP.svg";
import mcpLogoDark from "../../../theme/assets/MCP-dark.svg";

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
  truncate: "end",
  maw: "calc(100% - 40px)",
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
        <Group h="100%" px="md" wrap="nowrap" gap={0}>
          <Group gap="md" wrap="nowrap" w="33.33%" miw={0}>
            <Image src={colorScheme === "dark" ? mcpLogoDark : mcpLogo} alt="MCP" w={28} h={28} fit="contain" />
            <ServerName>{serverName}</ServerName>
          </Group>

          <Group w="33.33%" justify="center">
            <SegmentedControl
              value={activeTab}
              onChange={onTabChange}
              data={availableTabs}
              size="sm"
            />
          </Group>

          <Group gap="sm" w="33.33%" justify="flex-end">
            <StatusIndicator status={status} latencyMs={latencyMs} />
            <Button
              variant="outline"
              color="red"
              size="sm"
              onClick={onDisconnect}
            >
              Disconnect
            </Button>
            <ActionIcon
              variant="default"
              size="lg"
              aria-label="Toggle color scheme"
              onClick={onToggleTheme}
            >
              {colorScheme === "dark" ? "\u2600" : "\u263E"}
            </ActionIcon>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  );
}
