import { useEffect, useRef, useState } from "react";
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
  listChanged: boolean;
  onRefreshList: () => void;
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
  callState,
  listChanged,
  onRefreshList,
  onCallTool,
  onCancelCall,
  onClearResult,
}: ToolsScreenProps) {
  const [selectedToolName, setSelectedToolName] = useState<string | undefined>(
    undefined,
  );
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const selectedTool = selectedToolName
    ? tools.find((t) => t.name === selectedToolName)
    : undefined;
  const isExecuting = callState?.status === "pending";

  // The result lives in App so it survives pending → ok/error without
  // remounting the screen. But the screen's selection is local and resets when
  // the screen unmounts on tab switch — leaving the Results panel showing a
  // result with no selected tool. Clear the result on unmount so returning to
  // the screen starts from a clean slate. A ref keeps the latest handler so the
  // effect can stay mount/unmount-only without re-running mid-session.
  const onClearResultRef = useRef(onClearResult);
  useEffect(() => {
    onClearResultRef.current = onClearResult;
  }, [onClearResult]);
  useEffect(() => {
    return () => {
      onClearResultRef.current?.();
    };
  }, []);

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
              // Seed the form with the tool's schema defaults so default-only
              // fields the user never edits are still sent on execute (the
              // form shows defaults via resolveValue, but onChange only writes
              // edited fields).
              const tool = tools.find((t) => t.name === name);
              setFormValues(
                tool ? collectSchemaDefaults(tool.inputSchema) : {},
              );
              setSelectedToolName(name);
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
