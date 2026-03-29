import {
  Card,
  Container,
  Grid,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { ListChangedIndicator } from "../../elements/ListChangedIndicator/ListChangedIndicator";
import { ToolListItem } from "../../groups/ToolListItem/ToolListItem";
import { ToolDetailPanel } from "../../groups/ToolDetailPanel/ToolDetailPanel";
import { ResultPanel } from "../../groups/ResultPanel/ResultPanel";
import type { ToolListItemProps } from "../../groups/ToolListItem/ToolListItem";
import type { ToolDetailPanelProps } from "../../groups/ToolDetailPanel/ToolDetailPanel";
import type { ResultPanelProps } from "../../groups/ResultPanel/ResultPanel";

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

const PageContainer = Container.withProps({
  size: "xl",
  py: "xl",
});

const FullHeightCard = Card.withProps({
  withBorder: true,
  padding: "lg",
  h: "100%",
});

const EmptyState = Text.withProps({
  c: "dimmed",
  ta: "center",
  py: "xl",
});

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
    <PageContainer>
      <Grid align="stretch">
        <Grid.Col span={3}>
          <FullHeightCard>
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
          </FullHeightCard>
        </Grid.Col>

        <Grid.Col span={5}>
          <FullHeightCard>
            {selectedTool ? (
              <ToolDetailPanel {...selectedTool} />
            ) : (
              <EmptyState>Select a tool to view details</EmptyState>
            )}
          </FullHeightCard>
        </Grid.Col>

        <Grid.Col span={4}>
          <FullHeightCard>
            {result ? (
              <ResultPanel {...result} />
            ) : (
              <EmptyState>Results will appear here</EmptyState>
            )}
          </FullHeightCard>
        </Grid.Col>
      </Grid>
    </PageContainer>
  );
}
