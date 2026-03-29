import type { ReactNode } from "react";
import { AppShell } from "@mantine/core";
import { ViewHeader } from "../../groups/ViewHeader/ViewHeader";

export interface HomeLayoutProps {
  children: ReactNode;
  onToggleTheme: () => void;
}

export function UnconnectedView({ children, onToggleTheme }: HomeLayoutProps) {
  return (
    <AppShell header={{ height: 60 }} padding="md">
      <AppShell.Header>
        <ViewHeader connected={false} onToggleTheme={onToggleTheme} />
      </AppShell.Header>
      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  );
}
