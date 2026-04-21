import type { ReactNode } from "react";
import { AppShell } from "@mantine/core";
import type { Implementation } from "@modelcontextprotocol/sdk/types.js";
import type { ConnectionStatus } from "@inspector/core/mcp/types.js";
import { ViewHeader } from "../../groups/ViewHeader/ViewHeader";

export interface ConnectedLayoutProps {
  serverInfo: Implementation;
  status: ConnectionStatus;
  latencyMs?: number;
  activeTab: string;
  availableTabs: string[];
  onTabChange: (tab: string) => void;
  onDisconnect: () => void;
  onToggleTheme: () => void;
  children: ReactNode;
}

export function ConnectedView({
  serverInfo,
  status,
  latencyMs,
  activeTab,
  availableTabs,
  onTabChange,
  onDisconnect,
  onToggleTheme,
  children,
}: ConnectedLayoutProps) {
  return (
    <AppShell header={{ height: 60 }} padding="md">
      <AppShell.Header>
        <ViewHeader
          connected
          serverInfo={serverInfo}
          status={status}
          latencyMs={latencyMs}
          activeTab={activeTab}
          availableTabs={availableTabs}
          onTabChange={onTabChange}
          onDisconnect={onDisconnect}
          onToggleTheme={onToggleTheme}
        />
      </AppShell.Header>
      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  );
}
