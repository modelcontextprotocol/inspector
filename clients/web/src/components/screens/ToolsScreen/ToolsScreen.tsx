import { Card, Flex, Grid, Stack, Text } from "@mantine/core";
import { ToolControls } from "../../groups/ToolControls/ToolControls";
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

const ScreenLayout = Flex.withProps({
  variant: "screen",
  h: "calc(100vh - var(--app-shell-header-height, 0px))",
  gap: "xl",
  p: "xl",
});

const Sidebar = Stack.withProps({
  w: 340,
  flex: "0 0 auto",
});

const SidebarCard = Card.withProps({
  withBorder: true,
  padding: "lg",
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
  return (
    <ScreenLayout>
      <Sidebar>
        <SidebarCard>
          <ToolControls
            tools={tools}
            listChanged={listChanged}
            searchText={searchText}
            onSearchChange={onSearchChange}
            onRefreshList={onRefreshList}
            onSelectTool={onSelectTool}
          />
        </SidebarCard>
      </Sidebar>

      <Grid align="stretch" flex={1}>
        <Grid.Col span={7}>
          <FullHeightCard>
            {selectedTool ? (
              <ToolDetailPanel {...selectedTool} />
            ) : (
              <EmptyState>Select a tool to view details</EmptyState>
            )}
          </FullHeightCard>
        </Grid.Col>

        <Grid.Col span={5}>
          <FullHeightCard>
            {result ? (
              <ResultPanel {...result} />
            ) : (
              <EmptyState>Results will appear here</EmptyState>
            )}
          </FullHeightCard>
        </Grid.Col>
      </Grid>
    </ScreenLayout>
  );
}
