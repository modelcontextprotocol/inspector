import { useState } from "react";
import { ScrollArea, SimpleGrid, Stack, Text } from "@mantine/core";
import type { ServerEntry } from "@inspector/core/mcp/types.js";
import { ServerCard } from "../../groups/ServerCard/ServerCard";
import { ServerListControls } from "../../groups/ServerListControls/ServerListControls";

export interface ServerListScreenProps {
  servers: ServerEntry[];
  /** Id of the server the wiring layer treats as active (drives card dimming). */
  activeServer?: string;
  onAddManually: () => void;
  onImportConfig: () => void;
  onImportServerJson: () => void;
  onToggleConnection: (id: string) => void;
  onServerInfo: (id: string) => void;
  onSettings: (id: string) => void;
  onEdit: (id: string) => void;
  onClone: (id: string) => void;
  onRemove: (id: string) => void;
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
  activeServer,
  onAddManually,
  onImportConfig,
  onImportServerJson,
  onToggleConnection,
  onServerInfo,
  onSettings,
  onEdit,
  onClone,
  onRemove,
}: ServerListScreenProps) {
  const [compact, setCompact] = useState<boolean>(false);

  function handleToggleList() {
    setCompact((prev) => !prev);
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
                key={server.id}
                compact={compact}
                activeServer={activeServer}
                onToggleConnection={onToggleConnection}
                onServerInfo={onServerInfo}
                onSettings={onSettings}
                onEdit={onEdit}
                onClone={onClone}
                onRemove={onRemove}
                {...server}
              />
            ))}
          </SimpleGrid>
        )}
      </ScrollArea.Autosize>
    </PageContainer>
  );
}
