import type { ReactNode } from "react";
import { AppShell } from "@mantine/core";
import { ViewHeader } from "../../groups/ViewHeader/ViewHeader";

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

export function ConnectedView({
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
  return (
    <AppShell header={{ height: 60 }} padding="md">
      <AppShell.Header>
        <ViewHeader
          connected
          serverName={serverName}
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
