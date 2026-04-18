import { useState } from "react";
import { Group, ScrollArea, Stack, TextInput, Title } from "@mantine/core";
import type { Prompt } from "@modelcontextprotocol/sdk/types.js";
import { ListChangedIndicator } from "../../elements/ListChangedIndicator/ListChangedIndicator";
import { PromptListItem } from "../PromptListItem/PromptListItem";

export interface PromptControlsProps {
  prompts: Prompt[];
  selectedName?: string;
  listChanged: boolean;
  onRefreshList: () => void;
  onSelectPrompt: (name: string) => void;
}

const LIST_MAX_HEIGHT =
  "calc(100vh - var(--app-shell-header-height, 0px) - var(--mantine-spacing-xl) * 2 - 160px)";

export function PromptControls({
  prompts,
  selectedName,
  listChanged,
  onRefreshList,
  onSelectPrompt,
}: PromptControlsProps) {
  const [searchText, setSearchText] = useState("");
  const query = searchText.toLowerCase();
  const filteredPrompts = prompts.filter(
    (p) =>
      p.name.toLowerCase().includes(query) ||
      (p.title?.toLowerCase().includes(query) ?? false) ||
      (p.description?.toLowerCase().includes(query) ?? false),
  );

  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <Title order={4}>Prompts</Title>
        <ListChangedIndicator visible={listChanged} onRefresh={onRefreshList} />
      </Group>
      <TextInput
        placeholder="Search prompts..."
        value={searchText}
        onChange={(e) => setSearchText(e.currentTarget.value)}
      />
      <ScrollArea.Autosize mah={LIST_MAX_HEIGHT}>
        <Stack gap="xs">
          {filteredPrompts.map((prompt) => (
            <PromptListItem
              key={prompt.name}
              prompt={prompt}
              selected={prompt.name === selectedName}
              onClick={() => {
                if (prompt.name !== selectedName) onSelectPrompt(prompt.name);
              }}
            />
          ))}
        </Stack>
      </ScrollArea.Autosize>
    </Stack>
  );
}
