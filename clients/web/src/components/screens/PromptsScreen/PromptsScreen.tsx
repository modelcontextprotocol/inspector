import { useState } from "react";
import {
  Alert,
  Card,
  CloseButton,
  Flex,
  Group,
  Loader,
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
  /**
   * Name of the prompt the in-flight / latest result is for. Used to
   * route the result panel only to the matching sidebar selection.
   */
  promptName?: string;
}

export interface PromptsScreenProps {
  prompts: Prompt[];
  getPromptState?: GetPromptState;
  listChanged: boolean;
  completionsSupported?: boolean;
  onRefreshList: () => void;
  onGetPrompt: (name: string, args: Record<string, string>) => void;
  onCopyMessages?: () => void;
  onCompleteArgument?: (
    ref:
      | { type: "ref/resource"; uri: string }
      | { type: "ref/prompt"; name: string },
    argumentName: string,
    argumentValue: string,
    context: Record<string, string>,
  ) => Promise<string[]>;
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
  withBorder: true,
  padding: "lg",
});

// Sized-to-content card with overflow handling. When the inner content
// fits, the card hugs it. When it doesn't, the inner ScrollArea inside
// PromptMessagesDisplay shrinks (flex 0 1 auto, mih 0) and scrolls.
const PreviewCard = Card.withProps({
  withBorder: true,
  padding: "lg",
  variant: "preview",
});

// Column wrapper that pins the card to the top of the available space
// and bounds its growth via the consumer-set `mah`.
const PreviewPane = Flex.withProps({
  flex: 1,
  miw: 0,
  direction: "column",
  align: "stretch",
});

const EmptyState = Text.withProps({
  c: "dimmed",
  ta: "center",
  py: "xl",
});

const SCROLL_MAX_HEIGHT =
  "calc(100vh - var(--app-shell-header-height, 0px) - var(--mantine-spacing-xl) * 2)";

function hasArguments(prompt: Prompt): boolean {
  return !!prompt.arguments && prompt.arguments.length > 0;
}

export function PromptsScreen({
  prompts,
  getPromptState,
  listChanged,
  completionsSupported,
  onRefreshList,
  onGetPrompt,
  onCopyMessages,
  onCompleteArgument,
}: PromptsScreenProps) {
  const [selectedPromptName, setSelectedPromptName] = useState<
    string | undefined
  >(undefined);
  const [argumentValues, setArgumentValues] = useState<Record<string, string>>(
    {},
  );
  // Track which prompt the user has already submitted in this session so
  // the form pane disappears once the user clicks Get Prompt. Cleared on
  // sidebar switch so the form re-appears for a freshly-selected prompt.
  const [submittedFor, setSubmittedFor] = useState<string | undefined>(
    undefined,
  );

  const selectedPrompt = selectedPromptName
    ? prompts.find((p) => p.name === selectedPromptName)
    : undefined;

  function handleSelectPrompt(name: string) {
    setArgumentValues({});
    setSelectedPromptName(name);
    // Auto-fetch no-argument prompts the moment they're selected — the
    // form pane would otherwise just render a bare Get Prompt button
    // with nothing to fill in. Prompts with arguments wait for submit.
    const target = prompts.find((p) => p.name === name);
    if (target && !hasArguments(target)) {
      setSubmittedFor(name);
      onGetPrompt(name, {});
    } else {
      setSubmittedFor(undefined);
    }
  }

  function handleSubmit() {
    if (!selectedPrompt) return;
    setSubmittedFor(selectedPrompt.name);
    onGetPrompt(selectedPrompt.name, argumentValues);
  }

  function handleClosePreview() {
    // For prompts with arguments, flip back to the form so the user can
    // edit and re-submit (argumentValues are preserved). For no-arg
    // prompts there's no form to return to, so drop the selection and
    // fall back to the empty state.
    if (selectedPrompt && hasArguments(selectedPrompt)) {
      setSubmittedFor(undefined);
    } else {
      setSelectedPromptName(undefined);
      setSubmittedFor(undefined);
    }
  }

  // The preview is "active" when we've submitted (or auto-fetched) the
  // currently-selected prompt and the parent's result/pending/error state
  // matches. Without the name check, a stale result from a previous
  // prompt would leak into the new prompt's pane.
  const previewActive =
    !!selectedPrompt &&
    submittedFor === selectedPrompt.name &&
    (!getPromptState?.promptName ||
      getPromptState.promptName === selectedPrompt.name);

  function renderPreview() {
    if (!previewActive || !getPromptState) return null;
    if (getPromptState.status === "pending") {
      return (
        <PreviewCard>
          <Stack gap="md">
            <Group justify="flex-start">
              <CloseButton
                aria-label="Close messages"
                onClick={handleClosePreview}
              />
            </Group>
            <Stack align="center" py="xl">
              <Loader size="sm" />
              <Text c="dimmed">Loading prompt...</Text>
            </Stack>
          </Stack>
        </PreviewCard>
      );
    }
    if (getPromptState.status === "error") {
      return (
        <PreviewCard>
          <Stack gap="md">
            <Group justify="flex-start">
              <CloseButton
                aria-label="Close messages"
                onClick={handleClosePreview}
              />
            </Group>
            <Alert color="red" variant="light" title="Prompt Error">
              {getPromptState.error ?? "Failed to get prompt"}
            </Alert>
          </Stack>
        </PreviewCard>
      );
    }
    if (getPromptState.result) {
      return (
        <PreviewCard>
          <PromptMessagesDisplay
            messages={getPromptState.result.messages}
            onCopyAll={onCopyMessages}
            onClose={handleClosePreview}
          />
        </PreviewCard>
      );
    }
    return null;
  }

  return (
    <ScreenLayout>
      <Sidebar>
        <SidebarCard>
          <PromptControls
            prompts={prompts}
            selectedName={selectedPromptName}
            listChanged={listChanged}
            onRefreshList={onRefreshList}
            onSelectPrompt={handleSelectPrompt}
          />
        </SidebarCard>
      </Sidebar>

      {previewActive ? (
        // Result branch — sized to content, capped at viewport. Mirrors
        // the resource preview layout (see ResourcesScreen).
        <PreviewPane mah={SCROLL_MAX_HEIGHT}>{renderPreview()}</PreviewPane>
      ) : selectedPrompt && hasArguments(selectedPrompt) ? (
        // Argument-form branch — capped at 40% width so the form doesn't
        // stretch across the viewport on wide displays. Disappears once
        // the user clicks Get Prompt and previewActive flips on.
        <PreviewPane mah={SCROLL_MAX_HEIGHT} maw="40%">
          <PreviewCard>
            <PromptArgumentsForm
              prompt={selectedPrompt}
              argumentValues={argumentValues}
              onArgumentChange={(argName, value) =>
                setArgumentValues((prev) => ({ ...prev, [argName]: value }))
              }
              onGetPrompt={handleSubmit}
              completionsSupported={completionsSupported}
              onCompleteArgument={
                onCompleteArgument
                  ? (argName, value, context) =>
                      onCompleteArgument(
                        { type: "ref/prompt", name: selectedPrompt.name },
                        argName,
                        value,
                        context,
                      )
                  : undefined
              }
            />
          </PreviewCard>
        </PreviewPane>
      ) : (
        <DetailCard flex={1}>
          <EmptyState>Select a prompt to view details</EmptyState>
        </DetailCard>
      )}
    </ScreenLayout>
  );
}
