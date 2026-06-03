import { Card, Flex, Stack, Text } from "@mantine/core";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
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

export interface ToolsScreenProps {
  tools: Tool[];
  callState?: ToolCallState;
  // Selection + form values are controlled by the parent (App) so they persist
  // across tab navigation within a live session — the screen unmounts on tab
  // switch, so local state would be lost (#1414).
  selectedToolName?: string;
  formValues?: Record<string, unknown>;
  searchText?: string;
  listChanged: boolean;
  onSelectTool: (name: string) => void;
  onFormChange: (values: Record<string, unknown>) => void;
  onSearchChange: (value: string) => void;
  onRefreshList: () => void;
  onCallTool: (name: string, args: Record<string, unknown>) => void;
  onCancelCall?: () => void;
  onClearResult?: () => void;
}

// Caps the detail/result columns at the screen's available height: full
// viewport minus the app-shell header and the screen's top+bottom xl padding,
// leaving the bottom margin the overflow used to eat.
const SCROLL_MAX_HEIGHT =
  "calc(100vh - var(--app-shell-header-height, 0px) - var(--mantine-spacing-xl) * 2)";

// No `align` override: children stretch to the row's full height, giving each
// column pane a definite height. That definite height is what lets a column's
// inner ScrollArea know how much it can shrink into (a bare `mah` doesn't —
// see the Prompts/Resources preview panes this mirrors).
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
  selectedToolName,
  formValues,
  searchText = "",
  listChanged,
  onSelectTool,
  onFormChange,
  onSearchChange,
  onRefreshList,
  onCallTool,
  onCancelCall,
  onClearResult,
}: ToolsScreenProps) {
  const selectedTool = selectedToolName
    ? tools.find((t) => t.name === selectedToolName)
    : undefined;
  const isExecuting = callState?.status === "pending";
  // Selection, inputs, and result all live in App now, so they persist when the
  // user navigates away and back — no clear-on-unmount needed (#1414).
  const values = formValues ?? {};

  return (
    <ScreenLayout>
      <Sidebar>
        <SidebarCard>
          <ToolControls
            tools={tools}
            selectedName={selectedToolName}
            searchText={searchText}
            listChanged={listChanged}
            onRefreshList={onRefreshList}
            onSearchChange={onSearchChange}
            onSelectTool={(name) => {
              // Seed the form with the tool's schema defaults so default-only
              // fields the user never edits are still sent on execute (the
              // form shows defaults via resolveValue, but onChange only writes
              // edited fields).
              const tool = tools.find((t) => t.name === name);
              onFormChange(tool ? collectSchemaDefaults(tool.inputSchema) : {});
              onSelectTool(name);
            }}
          />
        </SidebarCard>
      </Sidebar>

      <ContentPane mah={SCROLL_MAX_HEIGHT}>
        <ContentCard>
          {selectedTool ? (
            <ToolDetailPanel
              tool={selectedTool}
              formValues={values}
              isExecuting={isExecuting}
              progress={callState?.progress}
              onFormChange={onFormChange}
              onExecute={() => onCallTool(selectedTool.name, values)}
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
            />
          ) : (
            <EmptyState>Results will appear here</EmptyState>
          )}
        </ContentCard>
      </ContentPane>
    </ScreenLayout>
  );
}
