import { useState } from "react";
import { ScrollArea, SimpleGrid, Stack, Text } from "@mantine/core";
import { ServerCard } from "../../groups/ServerCard/ServerCard";
import { ServerListControls } from "../../groups/ServerListControls/ServerListControls";
import type { ServerCardProps } from "../../groups/ServerCard/ServerCard";

export interface ServerListScreenProps {
  servers: ServerCardProps[];
  onAddManually: () => void;
  onImportConfig: () => void;
  onImportServerJson: () => void;
}

const PageContainer = Stack.withProps({
  p: "xl",
});

const EmptyState = Text.withProps({
  c: "dimmed",
  ta: "center",
  py: "xl",
});

export function ServerListScreen({
  servers,
  onAddManually,
  onImportConfig,
  onImportServerJson,
}: ServerListScreenProps) {
  const [compact, setCompact] = useState<boolean>(false);
  const [activeServer, setActiveServer] = useState<string | undefined>();

  function handleToggleList() {
    setCompact((prev) => (prev === true ? false : true));
  }

  return (
    <PageContainer>
      <ServerListControls
        serverCount={servers.length}
        compact={compact}
        onToggleList={handleToggleList}
        onAddManually={onAddManually}
        onImportConfig={onImportConfig}
        onImportServerJson={onImportServerJson}
      />

      <ScrollArea.Autosize mah="calc(100vh - var(--app-shell-header-height, 60px) - var(--mantine-spacing-xl) * 2 - 60px)">
        {servers.length === 0 ? (
          <EmptyState>
            No servers configured. Add a server to get started.
          </EmptyState>
        ) : (
          <SimpleGrid
            cols={{ base: 1, sm: 2, lg: 3 }}
            spacing="lg"
            className="grid-align-start"
          >
            {servers.map((server) => (
              <ServerCard
                key={server.name}
                compact={compact}
                activeServer={activeServer}
                onSetActiveServer={setActiveServer}
                {...server}
              />
            ))}
          </SimpleGrid>
        )}
      </ScrollArea.Autosize>
    </PageContainer>
  );
}
