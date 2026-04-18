import { useState } from "react";
import { Card, Flex, Stack, Text } from "@mantine/core";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { ToolControls } from "../../groups/ToolControls/ToolControls";
import {
  ToolDetailPanel,
  type ToolProgress,
} from "../../groups/ToolDetailPanel/ToolDetailPanel";
import { ToolResultPanel } from "../../groups/ToolResultPanel/ToolResultPanel";

export interface ToolCallState {
  status: "idle" | "pending" | "ok" | "error";
  result?: CallToolResult;
  error?: string;
  progress?: ToolProgress;
}

export interface ToolsScreenProps {
  tools: Tool[];
  selectedToolName?: string;
  callState?: ToolCallState;
  listChanged: boolean;
  onRefreshList: () => void;
  onSelectTool: (name: string) => void;
  onCallTool: (name: string, args: Record<string, unknown>) => void;
  onCancelCall?: () => void;
  onClearResult?: () => void;
}

const ScreenLayout = Flex.withProps({
  variant: "screen",
  h: "calc(100vh - var(--app-shell-header-height, 0px))",
  gap: "md",
  p: "xl",
  align: "flex-start",
});

const Sidebar = Stack.withProps({
  w: 340,
  flex: "0 0 auto",
});

const SidebarCard = Card.withProps({
  withBorder: true,
  padding: "lg",
});

const ContentCard = Card.withProps({
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
  selectedToolName,
  callState,
  listChanged,
  onRefreshList,
  onSelectTool,
  onCallTool,
  onCancelCall,
  onClearResult,
}: ToolsScreenProps) {
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
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
            listChanged={listChanged}
            onRefreshList={onRefreshList}
            onSelectTool={(name) => {
              setFormValues({});
              onSelectTool(name);
            }}
          />
        </SidebarCard>
      </Sidebar>

      <ContentCard flex={1}>
        {selectedTool ? (
          <ToolDetailPanel
            tool={selectedTool}
            formValues={formValues}
            isExecuting={isExecuting}
            progress={callState?.progress}
            onFormChange={setFormValues}
            onExecute={() => onCallTool(selectedTool.name, formValues)}
            onCancel={() => onCancelCall?.()}
          />
        ) : (
          <EmptyState>Select a tool to view details</EmptyState>
        )}
      </ContentCard>

      <ContentCard flex={1}>
        {callState?.result ? (
          <ToolResultPanel
            result={callState.result}
            onClear={() => onClearResult?.()}
          />
        ) : (
          <EmptyState>Results will appear here</EmptyState>
        )}
      </ContentCard>
    </ScreenLayout>
  );
}
