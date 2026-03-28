import { Container, Group, SimpleGrid, Stack, Text } from "@mantine/core";
import { ServerCard } from "../../groups/ServerCard/ServerCard";
import { AddServerMenu } from "../../groups/AddServerMenu/AddServerMenu";
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
  return (
    <PageContainer>
      <Stack gap="lg">
        <Group justify="flex-end">
          <AddServerMenu
            onAddManually={onAddManually}
            onImportConfig={onImportConfig}
            onImportServerJson={onImportServerJson}
          />
        </Group>

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
              <ServerCard key={server.name} {...server} />
            ))}
          </SimpleGrid>
        )}
      </Stack>
    </PageContainer>
  );
}
