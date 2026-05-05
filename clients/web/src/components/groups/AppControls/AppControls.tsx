import { useState } from "react";
import {
  Button,
  Group,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { ListChangedIndicator } from "../../elements/ListChangedIndicator/ListChangedIndicator";
import { AppListItem } from "../AppListItem/AppListItem";

export interface AppControlsProps {
  tools: Tool[];
  selectedName?: string;
  listChanged: boolean;
  onRefreshList: () => void;
  onSelectApp: (name: string) => void;
}

const LIST_MAX_HEIGHT =
  "calc(100vh - var(--app-shell-header-height, 0px) - var(--mantine-spacing-xl) * 2 - 220px)";

const ToolbarButton = Button.withProps({
  variant: "subtle",
  size: "sm",
});

const EmptyState = Text.withProps({
  c: "dimmed",
  ta: "center",
  py: "xl",
});

export function AppControls({
  tools,
  selectedName,
  listChanged,
  onRefreshList,
  onSelectApp,
}: AppControlsProps) {
  const [searchText, setSearchText] = useState("");
  const query = searchText.toLowerCase();
  const filteredTools = searchText
    ? tools.filter(
        (tool) =>
          tool.name.toLowerCase().includes(query) ||
          (tool.title?.toLowerCase().includes(query) ?? false),
      )
    : tools;

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Title order={4}>MCP Apps ({tools.length})</Title>
        <ToolbarButton onClick={onRefreshList}>Refresh</ToolbarButton>
      </Group>
      <ListChangedIndicator visible={listChanged} onRefresh={onRefreshList} />
      <TextInput
        placeholder="Search apps..."
        value={searchText}
        onChange={(e) => setSearchText(e.currentTarget.value)}
      />
      <ScrollArea.Autosize mah={LIST_MAX_HEIGHT}>
        <Stack gap="xs">
          {filteredTools.length === 0 ? (
            <EmptyState>
              {tools.length === 0 ? "No apps available" : "No matching apps"}
            </EmptyState>
          ) : (
            filteredTools.map((tool) => (
              <AppListItem
                key={tool.name}
                tool={tool}
                selected={tool.name === selectedName}
                onClick={() => {
                  if (tool.name !== selectedName) onSelectApp(tool.name);
                }}
              />
            ))
          )}
        </Stack>
      </ScrollArea.Autosize>
    </Stack>
  );
}
