import { useCallback, useMemo, useState } from "react";
import { Button, Card, Flex, Group, Paper, Stack, Text } from "@mantine/core";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { MdRestartAlt } from "react-icons/md";
import { ProtocolPaletteSidebar } from "../../groups/ProtocolPaletteSidebar/ProtocolPaletteSidebar";
import { ProtocolStepList } from "../../groups/ProtocolStepList/ProtocolStepList";
import { ProtocolOutputPanel } from "../../groups/ProtocolOutputPanel/ProtocolOutputPanel";
import {
  addStepToBranch,
  collectRecVars,
  collectSendLabels,
  convertPairToChoice,
  deriveReceiveOptions,
  findBranchLabel,
  generatePythonSnippet,
  isBranchTerminated,
  isTerminated,
  removeStepDeep,
  stepsToProtocol,
  uid,
  updateStepDeep,
  type Direction,
  type InsertTarget,
  type ProtocolStep,
} from "./protocol";

export interface ProtocolBuilderScreenProps {
  tools: Tool[];
  listChanged: boolean;
  onRefreshTools: () => void;
}

const ScreenLayout = Flex.withProps({
  variant: "screen",
  h: "calc(100vh - var(--app-shell-header-height, 0px))",
  gap: "md",
  p: "xl",
  align: "flex-start",
});

const SidebarColumn = Stack.withProps({
  w: 320,
  flex: "0 0 auto",
});

const SidebarCard = Card.withProps({
  withBorder: true,
  padding: "lg",
});

const SequenceCard = Card.withProps({
  withBorder: true,
  padding: "lg",
});

const OutputCard = Card.withProps({
  withBorder: true,
  padding: "lg",
});

const SequenceHeader = Group.withProps({
  justify: "space-between",
  align: "center",
});

const EmptyDrop = Paper.withProps({
  withBorder: true,
  p: "xl",
  ta: "center",
  c: "dimmed",
});

const TerminalIndicator = Paper.withProps({
  withBorder: true,
  px: "sm",
  py: 6,
});

export function ProtocolBuilderScreen({
  tools,
  listChanged,
  onRefreshTools,
}: ProtocolBuilderScreenProps) {
  const [steps, setSteps] = useState<ProtocolStep[]>([]);
  const [insertTarget, setInsertTarget] = useState<InsertTarget | null>(null);
  const [copied, setCopied] = useState<"dsl" | "python" | null>(null);

  const protocol = useMemo(() => stepsToProtocol(steps), [steps]);
  const pythonSnippet = useMemo(
    () => generatePythonSnippet(protocol),
    [protocol],
  );
  const recVars = useMemo(() => collectRecVars(steps), [steps]);
  const sendLabels = useMemo(() => collectSendLabels(steps), [steps]);
  const receiveOptions = useMemo(
    () => deriveReceiveOptions(sendLabels),
    [sendLabels],
  );
  const targetLabel = useMemo(
    () => (insertTarget ? findBranchLabel(steps, insertTarget) : null),
    [insertTarget, steps],
  );
  const targetTerminated = useMemo(
    () =>
      insertTarget
        ? isBranchTerminated(
            steps,
            insertTarget.choiceStepId,
            insertTarget.branchId,
          )
        : isTerminated(steps),
    [insertTarget, steps],
  );

  const addStepToTarget = useCallback(
    (step: ProtocolStep) => {
      if (insertTarget) {
        setSteps((prev) =>
          addStepToBranch(
            prev,
            insertTarget.choiceStepId,
            insertTarget.branchId,
            step,
          ),
        );
      } else {
        setSteps((prev) => [...prev, step]);
      }
    },
    [insertTarget],
  );

  const handleAddTool = useCallback(
    (tool: Tool) => {
      const pair = uid();
      const sendStep: ProtocolStep = {
        id: uid(),
        type: "action",
        direction: "send",
        label: tool.name,
        toolName: tool.name,
        pairId: pair,
      };
      const recvStep: ProtocolStep = {
        id: uid(),
        type: "action",
        direction: "receive",
        label: `${tool.name}Result`,
        toolName: tool.name,
        pairId: pair,
      };
      addStepToTarget(sendStep);
      addStepToTarget(recvStep);
    },
    [addStepToTarget],
  );

  const handleAddPair = useCallback(() => {
    const pair = uid();
    addStepToTarget({
      id: uid(),
      type: "action",
      direction: "send",
      label: "Action",
      pairId: pair,
    });
    addStepToTarget({
      id: uid(),
      type: "action",
      direction: "receive",
      label: "ActionResult",
      pairId: pair,
    });
  }, [addStepToTarget]);

  const handleAddChoice = useCallback(
    (direction: Direction) => {
      addStepToTarget({
        id: uid(),
        type: "choice",
        direction,
        branches: [
          { id: uid(), label: "BranchA", steps: [] },
          { id: uid(), label: "BranchB", steps: [] },
        ],
      });
    },
    [addStepToTarget],
  );

  const handleAddRecursion = useCallback(() => {
    setSteps((prev) => {
      const varName = `X${collectRecVars(prev).length}`;
      const recStep: ProtocolStep = {
        id: uid(),
        type: "recursion",
        recVar: varName,
      };
      if (insertTarget) {
        return addStepToBranch(
          prev,
          insertTarget.choiceStepId,
          insertTarget.branchId,
          recStep,
        );
      }
      return [...prev, recStep];
    });
  }, [insertTarget]);

  const handleAddRecRef = useCallback(
    (varName: string) => {
      addStepToTarget({
        id: uid(),
        type: "action",
        isRecRef: true,
        recVar: varName,
      });
    },
    [addStepToTarget],
  );

  const handleUpdateStep = useCallback(
    (stepId: string, updater: (s: ProtocolStep) => ProtocolStep) => {
      setSteps((prev) => updateStepDeep(prev, stepId, updater));
    },
    [],
  );

  const handleRemoveStep = useCallback((stepId: string) => {
    setSteps((prev) => removeStepDeep(prev, stepId));
  }, []);

  const handleConvertToChoice = useCallback(
    (
      stepId: string,
      pairId: string,
      direction: Direction,
      branchLabels: string[],
    ) => {
      setSteps((prev) =>
        convertPairToChoice(prev, stepId, pairId, direction, branchLabels),
      );
    },
    [],
  );

  const handleClear = useCallback(() => {
    setSteps([]);
    setInsertTarget(null);
  }, []);

  const flashCopied = useCallback((kind: "dsl" | "python") => {
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 2000);
  }, []);

  const handleCopyDsl = useCallback(() => {
    navigator.clipboard?.writeText(protocol);
    flashCopied("dsl");
  }, [protocol, flashCopied]);

  const handleCopyPython = useCallback(() => {
    navigator.clipboard?.writeText(pythonSnippet);
    flashCopied("python");
  }, [pythonSnippet, flashCopied]);

  const handleDownload = useCallback(() => {
    const content = `# Protocol: ${protocol}\n\n${pythonSnippet}`;
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "protocol.py";
    a.click();
    URL.revokeObjectURL(url);
  }, [protocol, pythonSnippet]);

  return (
    <ScreenLayout>
      <SidebarColumn>
        <SidebarCard>
          <ProtocolPaletteSidebar
            tools={tools}
            recVars={recVars}
            listChanged={listChanged}
            targetTerminated={targetTerminated}
            targetLabel={targetLabel}
            onRefreshTools={onRefreshTools}
            onClearTarget={() => setInsertTarget(null)}
            onAddTool={handleAddTool}
            onAddPair={handleAddPair}
            onAddInternalChoice={() => handleAddChoice("send")}
            onAddExternalChoice={() => handleAddChoice("receive")}
            onAddRecursion={handleAddRecursion}
            onAddRecRef={handleAddRecRef}
          />
        </SidebarCard>
      </SidebarColumn>

      <SequenceCard flex={1}>
        <Stack gap="sm">
          <SequenceHeader>
            <Text fw={600} size="sm">
              Protocol Sequence
            </Text>
            <Button
              variant="subtle"
              size="compact-xs"
              leftSection={<MdRestartAlt size={12} />}
              onClick={handleClear}
              disabled={steps.length === 0}
            >
              Clear
            </Button>
          </SequenceHeader>

          {steps.length === 0 ? (
            <EmptyDrop>
              <Text size="sm">
                Click tools or constructs on the left to build your protocol
              </Text>
            </EmptyDrop>
          ) : (
            <Stack gap="xs">
              <ProtocolStepList
                steps={steps}
                tools={tools}
                receiveOptions={receiveOptions}
                insertTarget={insertTarget}
                onSetInsertTarget={setInsertTarget}
                onUpdateStep={handleUpdateStep}
                onRemoveStep={handleRemoveStep}
                onConvertToChoice={handleConvertToChoice}
              />
              <TerminalIndicator>
                <Text ff="monospace" size="xs" c="dimmed" fs="italic">
                  end
                </Text>
              </TerminalIndicator>
            </Stack>
          )}
        </Stack>
      </SequenceCard>

      <OutputCard flex={1}>
        <Stack gap="sm">
          <Text fw={600} size="sm">
            Output
          </Text>
          <ProtocolOutputPanel
            protocol={protocol}
            pythonSnippet={pythonSnippet}
            copied={copied}
            onCopyDsl={handleCopyDsl}
            onCopyPython={handleCopyPython}
            onDownload={handleDownload}
          />
        </Stack>
      </OutputCard>
    </ScreenLayout>
  );
}
