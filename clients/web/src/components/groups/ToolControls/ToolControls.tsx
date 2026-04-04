import { useState } from "react";
import { Group, ScrollArea, Stack, TextInput, Title } from "@mantine/core";
import { ListChangedIndicator } from "../../elements/ListChangedIndicator/ListChangedIndicator";
import { ToolListItem } from "../ToolListItem/ToolListItem";
import type { ToolListItemProps } from "../ToolListItem/ToolListItem";

export interface ToolControlsProps {
  tools: ToolListItemProps[];
  listChanged: boolean;
  onRefreshList: () => void;
  onSelectTool: (name: string) => void;
}

function listMaxHeight(): string {
  return "calc(100vh - var(--app-shell-header-height, 0px) - var(--mantine-spacing-xl) * 2 - 160px)";
}

export function ToolControls({
  tools,
  listChanged,
  onRefreshList,
  onSelectTool,
}: ToolControlsProps) {
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
        <Title order={4}>Tools</Title>
        <ListChangedIndicator visible={listChanged} onRefresh={onRefreshList} />
      </Group>
      <TextInput
        placeholder="Search tools..."
        value={searchText}
        onChange={(e) => setSearchText(e.currentTarget.value)}
      />
      <ScrollArea.Autosize mah={listMaxHeight()}>
        <Stack gap="xs">
          {filteredTools.map((tool) => (
            <ToolListItem
              key={tool.name}
              {...tool}
              onClick={() => onSelectTool(tool.name)}
            />
          ))}
        </Stack>
      </ScrollArea.Autosize>
    </Stack>
  );
}
