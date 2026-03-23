import {
  Container,
  Group,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { ServerCard } from "../../molecules/ServerCard/ServerCard";
import { AddServerMenu } from "../../molecules/AddServerMenu/AddServerMenu";
import type { ServerCardProps } from "../../molecules/ServerCard/ServerCard";

export interface ServerListScreenProps {
  servers: ServerCardProps[];
  onAddManually: () => void;
  onImportConfig: () => void;
  onImportServerJson: () => void;
}

export function ServerListScreen({
  servers,
  onAddManually,
  onImportConfig,
  onImportServerJson,
}: ServerListScreenProps) {
  return (
    <Container size="xl" py="xl">
      <Stack gap="lg">
        <Group justify="space-between">
          <Title order={1}>MCP Inspector</Title>
          <AddServerMenu
            onAddManually={onAddManually}
            onImportConfig={onImportConfig}
            onImportServerJson={onImportServerJson}
          />
        </Group>

        {servers.length === 0 ? (
          <Text c="dimmed" ta="center" py="xl">
            No servers configured. Add a server to get started.
          </Text>
        ) : (
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg" className="grid-align-start">
            {servers.map((server) => (
              <ServerCard key={server.name} {...server} />
            ))}
          </SimpleGrid>
        )}
      </Stack>
    </Container>
  );
}
