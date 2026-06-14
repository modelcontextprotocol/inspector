import { Card, Flex, Stack, Text } from "@mantine/core";
import type {
  CallToolResult,
  ReadResourceResult,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { ToolControls } from "../../groups/ToolControls/ToolControls";
import {
  ToolDetailPanel,
  type ToolProgress,
} from "../../groups/ToolDetailPanel/ToolDetailPanel";
import { ToolResultPanel } from "../../groups/ToolResultPanel/ToolResultPanel";
import { collectSchemaDefaults } from "../../../utils/jsonUtils";

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
  "calc(100dvh - var(--app-shell-header-height, 0px) - var(--mantine-spacing-xl) * 2)";

// No `align` override: children stretch to the row's full height, giving each
// column pane a definite height. That definite height is what lets a column's
// inner ScrollArea know how much it can shrink into (a bare `mah` doesn't —
// see the Prompts/Resources preview panes this mirrors).
const ScreenLayout = Flex.withProps({
  variant: "screen",
  h: "calc(100dvh - var(--app-shell-header-height, 0px))",
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
            onSearchChange={(value) => onUiChange({ ...ui, search: value })}
            onSelectTool={(name) => {
              // Seed the form with the tool's schema defaults so default-only
              // fields the user never edits are still sent on execute (the
              // form shows defaults via resolveValue, but onChange only writes
              // edited fields).
              const tool = tools.find((t) => t.name === name);
              onUiChange({
                ...ui,
                selectedToolName: name,
                formValues: tool ? collectSchemaDefaults(tool.inputSchema) : {},
              });
            }}
          />
        </SidebarCard>
      </Sidebar>

      <ContentPane mah={SCROLL_MAX_HEIGHT}>
        <ContentCard>
          {selectedTool ? (
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
          ) : (
            <EmptyState>Select a tool to view details</EmptyState>
          )}
        </ContentCard>
      </ContentPane>

      <ContentPane mah={SCROLL_MAX_HEIGHT}>
        <ContentCard>
          {callState?.result ? (
            <ToolResultPanel
              result={callState.result}
              onClear={() => onClearResult?.()}
              onReadResource={onReadResource}
            />
          ) : (
            <EmptyState>Results will appear here</EmptyState>
          )}
        </ContentCard>
      </ContentPane>
    </ScreenLayout>
  );
}
