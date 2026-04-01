import { Card, Flex, Stack, Text } from "@mantine/core";
import { ToolControls } from "../../groups/ToolControls/ToolControls";
import { ToolDetailPanel } from "../../groups/ToolDetailPanel/ToolDetailPanel";
import { ToolResultPanel } from "../../groups/ToolResultPanel/ToolResultPanel";
import type { ToolListItemProps } from "../../groups/ToolListItem/ToolListItem";
import type { ToolDetailPanelProps } from "../../groups/ToolDetailPanel/ToolDetailPanel";
import type { ToolResultPanelProps } from "../../groups/ToolResultPanel/ToolResultPanel";

export interface ToolsScreenProps {
  tools: ToolListItemProps[];
  selectedTool?: ToolDetailPanelProps;
  result?: ToolResultPanelProps;
  listChanged: boolean;
  searchText: string;
  onSearchChange: (text: string) => void;
  onRefreshList: () => void;
  onSelectTool: (name: string) => void;
}

const ScreenLayout = Flex.withProps({
  variant: "screen",
  h: "calc(100vh - var(--app-shell-header-height, 0px))",
  gap: "md",
  p: "xl",
  align: "flex-start",
});

const Sidebar = Stack.withProps({
  w: 340,
  flex: "0 0 auto",
});

const SidebarCard = Card.withProps({
  withBorder: true,
  padding: "lg",
});

const ContentCard = Card.withProps({
  withBorder: true,
  padding: "lg",
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

      <ContentCard flex={1}>
        {selectedTool ? (
          <ToolDetailPanel {...selectedTool} />
        ) : (
          <EmptyState>Select a tool to view details</EmptyState>
        )}
      </ContentCard>

      <ContentCard flex={1}>
        {result ? (
          <ToolResultPanel {...result} />
        ) : (
          <EmptyState>Results will appear here</EmptyState>
        )}
      </ContentCard>
    </ScreenLayout>
  );
}
