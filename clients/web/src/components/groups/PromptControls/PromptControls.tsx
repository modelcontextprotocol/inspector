import { Group, ScrollArea, Stack, TextInput, Title } from "@mantine/core";
import { ClearButton } from "../../elements/ClearButton/ClearButton";
import type { Prompt } from "@modelcontextprotocol/client";
import { ListChangedIndicator } from "../../elements/ListChangedIndicator/ListChangedIndicator";
import {
  ListPaginationControls,
  type ListPaginationControlsProps,
} from "../../elements/ListPaginationControls/ListPaginationControls";
import { PromptListItem } from "../PromptListItem/PromptListItem";
import { useScrollMemory } from "../../../hooks/useScrollMemory";

export interface PromptControlsProps {
  prompts: Prompt[];
  selectedName?: string;
  // Search text is controlled by the parent (App, via PromptsScreen) so it
  // persists across tab navigation within a live session — see #1417.
  searchText?: string;
  listChanged: boolean;
  onRefreshList: () => void;
  /** Single-page pagination controls (#1721). */
  pagination: ListPaginationControlsProps;
  onSearchChange: (value: string) => void;
  onSelectPrompt: (name: string) => void;
}

export function PromptControls({
  prompts,
  selectedName,
  searchText = "",
  listChanged,
  onRefreshList,
  pagination,
  onSearchChange,
  onSelectPrompt,
}: PromptControlsProps) {
  const viewportRef = useScrollMemory("prompts-sidebar");
  const query = searchText.toLowerCase();
  const filteredPrompts = prompts.filter(
    (p) =>
      p.name.toLowerCase().includes(query) ||
      (p.title?.toLowerCase().includes(query) ?? false) ||
      (p.description?.toLowerCase().includes(query) ?? false),
  );

  return (
    // Fill the full-height `sidebar` Card (a flex column) so the list runs to the
    // bottom of the card before it scrolls, instead of being capped short by a
    // fixed max-height. `mih: 0` lets the scroll child shrink and scroll.
    <Stack gap="sm" flex={1} mih={0}>
      <Group justify="space-between">
        <Title order={4}>Prompts</Title>
        <ListChangedIndicator visible={listChanged} onRefresh={onRefreshList} />
      </Group>
      <TextInput
        placeholder="Search prompts..."
        value={searchText}
        onChange={(e) => onSearchChange(e.currentTarget.value)}
        rightSectionPointerEvents="auto"
        rightSection={
          searchText ? <ClearButton onClick={() => onSearchChange("")} /> : null
        }
      />
      <ListPaginationControls {...pagination} />
      <ScrollArea viewportRef={viewportRef} flex={1} mih={0}>
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
      </ScrollArea>
    </Stack>
  );
}
