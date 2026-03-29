import { useState } from "react";
import { Container, SimpleGrid, Stack, Text } from "@mantine/core";
import { ServerCard } from "../../groups/ServerCard/ServerCard";
import { ServerListControls } from "../../groups/ServerListControls/ServerListControls";
import type { ServerCardProps } from "../../groups/ServerCard/ServerCard";

export interface ServerListScreenProps {
  servers: ServerCardProps[];
  onAddManually: () => void;
  onImportConfig: () => void;
  onImportServerJson: () => void;
}

const PageContainer = Container.withProps({
  size: "xl",
  py: "xl",
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

  function handleToggleList() {
    setCompact((prev) => (prev === true ? false : true));
  }

  return (
    <PageContainer>
      <Stack gap="lg">
        <ServerListControls
          serverCount={servers.length}
          compact={compact}
          onToggleList={handleToggleList}
          onAddManually={onAddManually}
          onImportConfig={onImportConfig}
          onImportServerJson={onImportServerJson}
        />

        {servers.length === 0 ? (
          <EmptyState>
            No servers configured. Add a server to get started.
          </EmptyState>
        ) : (
          <SimpleGrid
            cols={{ base: 1, md: 2 }}
            spacing="lg"
            className="grid-align-start"
          >
            {servers.map((server) => (
              <ServerCard key={server.name} compact={compact} {...server} />
            ))}
          </SimpleGrid>
        )}
      </Stack>
    </PageContainer>
  );
}
