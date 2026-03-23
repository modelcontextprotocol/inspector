import { Card, Container, Grid, Stack, Text, TextInput, Title } from "@mantine/core";
import { ListChangedIndicator } from "../../atoms/ListChangedIndicator/ListChangedIndicator";
import { ToolListItem } from "../../molecules/ToolListItem/ToolListItem";
import { ToolDetailPanel } from "../../molecules/ToolDetailPanel/ToolDetailPanel";
import { ResultPanel } from "../../molecules/ResultPanel/ResultPanel";
import type { ToolListItemProps } from "../../molecules/ToolListItem/ToolListItem";
import type { ToolDetailPanelProps } from "../../molecules/ToolDetailPanel/ToolDetailPanel";
import type { ResultPanelProps } from "../../molecules/ResultPanel/ResultPanel";

export interface ToolsScreenProps {
  tools: ToolListItemProps[];
  selectedTool?: ToolDetailPanelProps;
  result?: ResultPanelProps;
  listChanged: boolean;
  searchText: string;
  onSearchChange: (text: string) => void;
  onRefreshList: () => void;
  onSelectTool: (name: string) => void;
}

export function ToolsScreen({
  tools,
  selectedTool,
  result,
  listChanged,
  searchText,
  onSearchChange,
  onRefreshList,
  onSelectTool,
}: ToolsScreenProps) {
  const filteredTools = searchText
    ? tools.filter((tool) =>
        tool.name.toLowerCase().includes(searchText.toLowerCase()),
      )
    : tools;

  return (
    <Container size="xl" py="xl">
    <Grid align="stretch">
      <Grid.Col span={3}>
        <Card withBorder padding="lg" h="100%">
          <Stack gap="sm">
            <Title order={4}>Tools</Title>
            <ListChangedIndicator
              visible={listChanged}
              onRefresh={onRefreshList}
            />
            <TextInput
              placeholder="Search tools..."
              value={searchText}
              onChange={(event) => onSearchChange(event.currentTarget.value)}
            />
            {filteredTools.map((tool) => (
              <ToolListItem
                key={tool.name}
                {...tool}
                onClick={() => onSelectTool(tool.name)}
              />
            ))}
          </Stack>
        </Card>
      </Grid.Col>

      <Grid.Col span={5}>
        <Card withBorder padding="lg" h="100%">
          {selectedTool ? (
            <ToolDetailPanel {...selectedTool} />
          ) : (
            <Text c="dimmed" ta="center" py="xl">
              Select a tool to view details
            </Text>
          )}
        </Card>
      </Grid.Col>

      <Grid.Col span={4}>
        <Card withBorder padding="lg" h="100%">
          {result ? (
            <ResultPanel {...result} />
          ) : (
            <Text c="dimmed" ta="center" py="xl">
              Results will appear here
            </Text>
          )}
        </Card>
      </Grid.Col>
    </Grid>
    </Container>
  );
}
