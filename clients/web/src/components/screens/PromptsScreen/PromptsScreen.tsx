import { useState } from "react";
import {
  Alert,
  Card,
  Flex,
  Group,
  Loader,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";
import type {
  GetPromptResult,
  Prompt,
} from "@modelcontextprotocol/sdk/types.js";
import { PromptControls } from "../../groups/PromptControls/PromptControls";
import { PromptArgumentsForm } from "../../groups/PromptArgumentsForm/PromptArgumentsForm";
import { PromptMessagesDisplay } from "../../groups/PromptMessagesDisplay/PromptMessagesDisplay";

export interface GetPromptState {
  status: "idle" | "pending" | "ok" | "error";
  result?: GetPromptResult;
  error?: string;
}

export interface PromptsScreenProps {
  prompts: Prompt[];
  selectedPromptName?: string;
  getPromptState?: GetPromptState;
  listChanged: boolean;
  onRefreshList: () => void;
  onSelectPrompt: (name: string) => void;
  onGetPrompt: (name: string, args: Record<string, string>) => void;
  onCopyMessages?: () => void;
}

const ScreenLayout = Flex.withProps({
  variant: "screen",
  h: "calc(100vh - var(--app-shell-header-height, 0px))",
  gap: "md",
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

const DetailCard = Card.withProps({
  flex: 1,
  withBorder: true,
  padding: "lg",
});

const EmptyState = Text.withProps({
  c: "dimmed",
  ta: "center",
  py: "xl",
});

export function PromptsScreen({
  prompts,
  selectedPromptName,
  getPromptState,
  listChanged,
  onRefreshList,
  onSelectPrompt,
  onGetPrompt,
  onCopyMessages,
}: PromptsScreenProps) {
  const [argumentValues, setArgumentValues] = useState<Record<string, string>>(
    {},
  );
  const selectedPrompt = selectedPromptName
    ? prompts.find((p) => p.name === selectedPromptName)
    : undefined;

  return (
    <ScreenLayout>
      <Sidebar>
        <SidebarCard>
          <PromptControls
            prompts={prompts}
            selectedName={selectedPromptName}
            listChanged={listChanged}
            onRefreshList={onRefreshList}
            onSelectPrompt={(name) => {
              setArgumentValues({});
              onSelectPrompt(name);
            }}
          />
        </SidebarCard>
      </Sidebar>

      <ScrollArea.Autosize
        flex={1}
        mah="calc(100vh - var(--app-shell-header-height, 0px) - var(--mantine-spacing-xl) * 2)"
      >
        <Group flex={1} gap="md" align="flex-start" wrap="nowrap">
          {selectedPrompt ? (
            <>
              <DetailCard>
                <PromptArgumentsForm
                  prompt={selectedPrompt}
                  argumentValues={argumentValues}
                  onArgumentChange={(name, value) =>
                    setArgumentValues((prev) => ({ ...prev, [name]: value }))
                  }
                  onGetPrompt={() =>
                    onGetPrompt(selectedPrompt.name, argumentValues)
                  }
                />
              </DetailCard>
              {getPromptState?.status === "pending" && (
                <DetailCard>
                  <Stack align="center" py="xl">
                    <Loader size="sm" />
                    <Text c="dimmed">Loading prompt...</Text>
                  </Stack>
                </DetailCard>
              )}
              {getPromptState?.status === "error" && (
                <DetailCard>
                  <Alert color="red" variant="light" title="Prompt Error">
                    {getPromptState.error ?? "Failed to get prompt"}
                  </Alert>
                </DetailCard>
              )}
              {getPromptState?.result && (
                <DetailCard>
                  <PromptMessagesDisplay
                    messages={getPromptState.result.messages}
                    onCopyAll={onCopyMessages}
                  />
                </DetailCard>
              )}
            </>
          ) : (
            <DetailCard>
              <EmptyState>Select a prompt to view details</EmptyState>
            </DetailCard>
          )}
        </Group>
      </ScrollArea.Autosize>
    </ScreenLayout>
  );
}
