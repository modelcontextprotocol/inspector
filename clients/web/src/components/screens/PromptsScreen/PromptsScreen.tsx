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
import type { GetPromptResult, Prompt } from "@modelcontextprotocol/client";
import { PromptControls } from "../../groups/PromptControls/PromptControls";
import type { ListPaginationControlsProps } from "../../elements/ListPaginationControls/ListPaginationControls";
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
  ui: PromptsUiState;
  listChanged: boolean;
  completionsSupported?: boolean;
  onUiChange: (next: PromptsUiState) => void;
  onRefreshList: () => void;
  /** Pagination controls rendered in the sidebar (#1721). */
  pagination: ListPaginationControlsProps;
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

// Selection, argument values, the "submitted" marker, and the sidebar search —
// controlled by the parent (App) as one object so they persist across tab
// navigation within a live session (#1417).
export interface PromptsUiState {
  selectedPromptName?: string;
  argumentValues: Record<string, string>;
  submittedFor?: string;
  search: string;
}

const ScreenLayout = Flex.withProps({
  variant: "screen",
  h: "calc(100dvh - var(--app-shell-header-height, 0px) - var(--app-shell-footer-height, 0px))",
  gap: "md",
  p: "xl",
});

const Sidebar = Stack.withProps({
  // Widened from 340 to comfortably fit the pagination controls
  // (Load-next-page button + status) without cramping list entries (#1721).
  w: 360,
  flex: "0 0 auto",
});

// `sidebar` variant makes the card a full-height flex column capped at the
// screen height, so PromptControls' list fills the card and scrolls internally
// once it overflows (matching the Resources sidebar).
const SidebarCard = Card.withProps({
  withBorder: true,
  padding: "lg",
  variant: "sidebar",
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
  "calc(100dvh - var(--app-shell-header-height, 0px) - var(--app-shell-footer-height, 0px) - var(--mantine-spacing-xl) * 2)";

function hasArguments(prompt: Prompt): boolean {
  return !!prompt.arguments && prompt.arguments.length > 0;
}

export function PromptsScreen({
  prompts,
  getPromptState,
  ui,
  listChanged,
  completionsSupported,
  onUiChange,
  onRefreshList,
  pagination,
  onGetPrompt,
  onCopyMessages,
  onCompleteArgument,
}: PromptsScreenProps) {
  const { selectedPromptName, argumentValues, submittedFor, search } = ui;
  const selectedPrompt = selectedPromptName
    ? prompts.find((p) => p.name === selectedPromptName)
    : undefined;

  function handleSelectPrompt(name: string) {
    // Re-clicking the active prompt in the sidebar shouldn't wipe the
    // user's typed argument values or trigger a re-fetch — sidebar is
    // for navigation, ✕ is for dismiss. Closing-then-reselecting is
    // its own thing (the close handler clears submittedFor). PromptControls
    // already swallows a re-click on the active item (it only fires
    // onSelectPrompt when the name differs), so this is a redundant guard
    // that never fires through the UI.
    /* v8 ignore next -- unreachable: PromptControls never re-emits the active name */
    if (name === selectedPromptName) return;
    // Auto-fetch no-argument prompts the moment they're selected — the
    // form pane would otherwise just render a bare Get Prompt button
    // with nothing to fill in. Prompts with arguments wait for submit.
    const target = prompts.find((p) => p.name === name);
    const autoFetch = !!target && !hasArguments(target);
    onUiChange({
      ...ui,
      argumentValues: {},
      selectedPromptName: name,
      submittedFor: autoFetch ? name : undefined,
    });
    if (autoFetch) onGetPrompt(name, {});
  }

  function handleSubmit() {
    // Defensive guard: handleSubmit is only wired to the argument form's
    // onGetPrompt, which renders solely when `selectedPrompt` is truthy, so
    // this never fires through the UI.
    /* v8 ignore next -- unreachable: form only renders with a selected prompt */
    if (!selectedPrompt) return;
    onUiChange({ ...ui, submittedFor: selectedPrompt.name });
    onGetPrompt(selectedPrompt.name, argumentValues);
  }

  function handleClosePreview() {
    // For prompts with arguments, flip back to the form so the user can
    // edit and re-submit (argumentValues are preserved). For no-arg
    // prompts there's no form to return to, so drop the selection and
    // fall back to the empty state.
    if (selectedPrompt && hasArguments(selectedPrompt)) {
      onUiChange({ ...ui, submittedFor: undefined });
    } else {
      onUiChange({
        ...ui,
        selectedPromptName: undefined,
        submittedFor: undefined,
      });
    }
  }

  // The preview is "active" when we've submitted (or auto-fetched) the
  // currently-selected prompt and the parent's state is tagged with
  // the matching prompt name. The name match guards against a stale
  // result from a previously-selected prompt leaking into the new
  // prompt's pane. App.tsx tags every state transition with
  // `promptName`, so we don't need a fallback for untagged states.
  const previewActive =
    !!selectedPrompt &&
    !!getPromptState &&
    submittedFor === selectedPrompt.name &&
    getPromptState.promptName === selectedPrompt.name;

  function renderPreview() {
    // Defensive guard: renderPreview is only invoked from the `previewActive`
    // branch below, and `previewActive` already requires a truthy
    // `getPromptState`, so neither arm of this condition is reachable here.
    /* v8 ignore next -- unreachable: only called when previewActive && getPromptState */
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
            searchText={search}
            listChanged={listChanged}
            onRefreshList={onRefreshList}
            pagination={pagination}
            onSearchChange={(value) => onUiChange({ ...ui, search: value })}
            onSelectPrompt={handleSelectPrompt}
          />
        </SidebarCard>
      </Sidebar>

      {previewActive ? (
        // Result branch — sized to content, capped at viewport. Mirrors
        // the resource preview layout (see ResourcesScreen).
        <PreviewPane mah={SCROLL_MAX_HEIGHT}>{renderPreview()}</PreviewPane>
      ) : selectedPrompt && hasArguments(selectedPrompt) ? (
        // Argument-form branch — fills the content pane's width (like the Tools
        // input form), replaced by the result once the user clicks Get Prompt
        // and previewActive flips on.
        <PreviewPane mah={SCROLL_MAX_HEIGHT}>
          <PreviewCard>
            <PromptArgumentsForm
              prompt={selectedPrompt}
              argumentValues={argumentValues}
              onArgumentChange={(argName, value) =>
                onUiChange({
                  ...ui,
                  argumentValues: { ...argumentValues, [argName]: value },
                })
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
