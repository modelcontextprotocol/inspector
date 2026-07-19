import { Card, Flex, Stack, Text } from "@mantine/core";
import type {
  CallToolResult,
  ReadResourceResult,
  Tool,
} from "@modelcontextprotocol/client";
import { ToolControls } from "../../groups/ToolControls/ToolControls";
import type { ListPaginationControlsProps } from "../../elements/ListPaginationControls/ListPaginationControls";
import {
  ToolDetailPanel,
  type ToolProgress,
} from "../../groups/ToolDetailPanel/ToolDetailPanel";
import { ToolResultPanel } from "../../groups/ToolResultPanel/ToolResultPanel";
import { resultHasResourceLinks } from "../../groups/ToolResultPanel/toolResultUtils";
import { collectSchemaDefaults, toFormSchema } from "../../../utils/jsonUtils";

export interface ToolCallState {
  status: "idle" | "pending" | "ok" | "error";
  result?: CallToolResult;
  error?: string;
  progress?: ToolProgress;
}

// Selection, form values, and sidebar search — controlled by the parent (App)
// as one object so they persist across tab navigation within a live session;
// the screen unmounts on tab switch, so local state would be lost (#1414/#1417).
export interface ToolsUiState {
  selectedToolName?: string;
  formValues: Record<string, unknown>;
  search: string;
  // Screen-level "Run as task" toggle, shared across tools (not per-tool):
  // selecting a different tool keeps the current value. Persists across tab
  // navigation like the rest of the UI state, and is only honored for the
  // selected tool when its `execution.taskSupport` is "optional" (a "required"
  // tool is always run as a task, "forbidden" never) — see ToolDetailPanel.
  runAsTask: boolean;
}

export interface ToolsScreenProps {
  tools: Tool[];
  callState?: ToolCallState;
  ui: ToolsUiState;
  listChanged: boolean;
  /** Whether the connected server advertises task-augmented tool calls. */
  serverSupportsTaskToolCalls: boolean;
  onUiChange: (next: ToolsUiState) => void;
  onRefreshList: () => void;
  /** Pagination controls rendered in the sidebar (#1721). */
  pagination: ListPaginationControlsProps;
  onCallTool: (
    name: string,
    args: Record<string, unknown>,
    runAsTask?: boolean,
  ) => void;
  onCancelCall?: () => void;
  onClearResult?: () => void;
  /**
   * Read-on-demand handler for `resource_link` blocks in a tool result.
   * Passed through to the result panel so links can inline their contents.
   */
  onReadResource?: (uri: string) => Promise<ReadResourceResult>;
}

// Caps the detail/result columns at the screen's available height: full
// viewport minus the app-shell header and the screen's top+bottom xl padding,
// leaving the bottom margin the overflow used to eat.
const SCROLL_MAX_HEIGHT =
  "calc(100dvh - var(--app-shell-header-height, 0px) - var(--app-shell-footer-height, 0px) - var(--mantine-spacing-xl) * 2)";

// No `align` override: children stretch to the row's full height, giving each
// column pane a definite height. That definite height is what lets a column's
// inner ScrollArea know how much it can shrink into (a bare `mah` doesn't —
// see the Prompts/Resources preview panes this mirrors).
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
// screen height, so ToolControls' list fills the card and scrolls internally
// once it overflows (matching the Resources sidebar). (#1417)
const SidebarCard = Card.withProps({
  withBorder: true,
  padding: "lg",
  variant: "sidebar",
});

// Column wrapper: stretches to the screen's available height (capped by the
// consumer-set `mah`) so the card inside has a definite height to shrink into.
const ContentPane = Flex.withProps({
  flex: 1,
  miw: 0,
  direction: "column",
  align: "stretch",
});

// Detail/result column card: `variant="preview"` (overflow: hidden) lets the
// panel's inner ScrollArea take over scrolling instead of the card bleeding
// past the viewport. Sizes to content when short, caps at the pane when tall.
const ContentCard = Card.withProps({
  withBorder: true,
  padding: "lg",
  variant: "preview",
});

// Full-height card for the empty placeholder (used with `flex={1}`) so it fills
// the screen height like the Prompts/Resources placeholders, rather than
// shrinking to its text. The result/detail states keep the content-sized
// `ContentCard` (their inner ScrollArea handles overflow).
const DetailCard = Card.withProps({
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
  callState,
  ui,
  listChanged,
  serverSupportsTaskToolCalls,
  onUiChange,
  onRefreshList,
  pagination,
  onCallTool,
  onCancelCall,
  onClearResult,
  onReadResource,
}: ToolsScreenProps) {
  const { selectedToolName, formValues, search } = ui;
  const selectedTool = selectedToolName
    ? tools.find((t) => t.name === selectedToolName)
    : undefined;
  const isExecuting = callState?.status === "pending";

  return (
    <ScreenLayout>
      <Sidebar>
        <SidebarCard>
          <ToolControls
            tools={tools}
            selectedName={selectedToolName}
            searchText={search}
            listChanged={listChanged}
            onRefreshList={onRefreshList}
            pagination={pagination}
            onSearchChange={(value) => onUiChange({ ...ui, search: value })}
            onSelectTool={(name) => {
              // Seed the form with the tool's schema defaults so default-only
              // fields the user never edits are still sent on execute (the
              // form shows defaults via resolveValue, but onChange only writes
              // edited fields).
              const tool = tools.find((t) => t.name === name);
              // `name` always comes from the rendered tools list (ToolControls
              // only emits names it was given), so the lookup never misses; the
              // empty-object fallback is an unreachable defensive default.
              let formValues: Record<string, unknown> = {};
              /* v8 ignore next -- unreachable: onSelectTool always names a tool in the list */
              if (tool)
                formValues = collectSchemaDefaults(
                  toFormSchema(tool.inputSchema) ?? {},
                );
              onUiChange({
                ...ui,
                selectedToolName: name,
                formValues,
              });
            }}
          />
        </SidebarCard>
      </Sidebar>

      {callState?.result ? (
        // Results replace the input form while present, and the panel's top-left
        // X dismisses them back to the form (#1661) — the Prompts screen pattern.
        // `formValues` live in the lifted UI state, so the form is restored
        // intact for a re-run. A call in flight sets a `pending` state with no
        // `result` (App.tsx), so the executing form (progress + cancel) shows
        // until the result lands.
        <ContentPane mah={SCROLL_MAX_HEIGHT}>
          {/* Fill the pane's full height only when the result renders a
              "Resource Links" box, so that box can expand into the available
              space and scroll within. Plain text/image/error results keep the
              content-sized card (matching the input-form state) instead of
              reserving a tall empty card. */}
          <ContentCard
            flex={resultHasResourceLinks(callState.result) ? 1 : undefined}
          >
            <ToolResultPanel
              result={callState.result}
              onClear={() => onClearResult?.()}
              onReadResource={onReadResource}
            />
          </ContentCard>
        </ContentPane>
      ) : selectedTool ? (
        <ContentPane mah={SCROLL_MAX_HEIGHT}>
          <ContentCard>
            <ToolDetailPanel
              tool={selectedTool}
              formValues={formValues}
              isExecuting={isExecuting}
              progress={callState?.progress}
              serverSupportsTaskToolCalls={serverSupportsTaskToolCalls}
              runAsTask={ui.runAsTask}
              onRunAsTaskChange={(value) =>
                onUiChange({ ...ui, runAsTask: value })
              }
              onFormChange={(values) =>
                onUiChange({ ...ui, formValues: values })
              }
              onExecute={(runAsTask) =>
                onCallTool(selectedTool.name, formValues, runAsTask)
              }
              onCancel={() => onCancelCall?.()}
            />
          </ContentCard>
        </ContentPane>
      ) : (
        // Empty placeholder fills the full screen height (like Prompts/Resources)
        // rather than shrinking to its text.
        <DetailCard flex={1}>
          <EmptyState>Select a tool to view details</EmptyState>
        </DetailCard>
      )}
    </ScreenLayout>
  );
}
