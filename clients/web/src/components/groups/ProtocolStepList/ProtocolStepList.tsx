import { useState, type JSX } from "react";
import {
  ActionIcon,
  Group,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  MdCallSplit,
  MdCenterFocusStrong,
  MdChevronRight,
  MdDelete,
  MdExpandMore,
  MdAdd,
} from "react-icons/md";
import {
  isTerminated,
  type Direction,
  type InsertTarget,
  type ProtocolBranch,
  type ProtocolStep,
} from "../../screens/ProtocolBuilderScreen/protocol";

export interface ProtocolStepListProps {
  steps: ProtocolStep[];
  tools: Tool[];
  receiveOptions: string[];
  insertTarget: InsertTarget | null;
  onSetInsertTarget: (target: InsertTarget | null) => void;
  onUpdateStep: (
    stepId: string,
    updater: (step: ProtocolStep) => ProtocolStep,
  ) => void;
  onRemoveStep: (stepId: string) => void;
  onConvertToChoice: (
    stepId: string,
    pairId: string,
    direction: Direction,
    branchLabels: string[],
  ) => void;
}

const SendCard = Paper.withProps({
  withBorder: true,
  p: "xs",
  radius: "sm",
  bg: "var(--inspector-protocol-send-bg)",
  bd: "1px solid var(--inspector-protocol-send-border)",
});

const ReceiveCard = Paper.withProps({
  withBorder: true,
  p: "xs",
  radius: "sm",
  bg: "var(--inspector-protocol-receive-bg)",
  bd: "1px solid var(--inspector-protocol-receive-border)",
});

const RecursionCard = Paper.withProps({
  withBorder: true,
  p: "xs",
  radius: "sm",
  bg: "var(--inspector-protocol-recursion-bg)",
  bd: "1px solid var(--inspector-protocol-recursion-border)",
});

const ChoiceCard = Paper.withProps({
  withBorder: true,
  p: 0,
  radius: "sm",
});

const ChoiceHeaderRow = Group.withProps({
  gap: "xs",
  px: "xs",
  py: 6,
  wrap: "nowrap",
});

const PairContainer = Paper.withProps({
  withBorder: true,
  p: 0,
  radius: "sm",
});

const Glyph = Text.withProps({
  span: true,
  ff: "monospace",
  size: "xs",
  fw: 700,
});

const RowGroup = Group.withProps({
  gap: "xs",
  align: "center",
  wrap: "nowrap",
});

const MonoInput = TextInput.withProps({
  flex: 1,
  size: "xs",
  styles: {
    input: { fontFamily: "var(--mantine-font-family-monospace)" },
  },
});

export function ProtocolStepList({
  steps,
  tools,
  receiveOptions,
  insertTarget,
  onSetInsertTarget,
  onUpdateStep,
  onRemoveStep,
  onConvertToChoice,
}: ProtocolStepListProps) {
  const rendered = new Set<string>();
  const elements: JSX.Element[] = [];

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (rendered.has(step.id)) continue;
    rendered.add(step.id);

    const next = i + 1 < steps.length ? steps[i + 1] : undefined;
    const isPaired =
      step.type === "action" &&
      step.direction === "send" &&
      step.pairId !== undefined &&
      next?.pairId === step.pairId;

    if (isPaired && next) {
      rendered.add(next.id);
      elements.push(
        <PairCard
          key={step.pairId ?? step.id}
          sendStep={step}
          recvStep={next}
          tools={tools}
          receiveOptions={receiveOptions}
          onUpdateStep={onUpdateStep}
          onRemoveStep={onRemoveStep}
          onConvertToChoice={onConvertToChoice}
        />,
      );
    } else {
      elements.push(
        <StepCard
          key={step.id}
          step={step}
          tools={tools}
          receiveOptions={receiveOptions}
          insertTarget={insertTarget}
          onSetInsertTarget={onSetInsertTarget}
          onUpdateStep={onUpdateStep}
          onRemoveStep={onRemoveStep}
          onConvertToChoice={onConvertToChoice}
        />,
      );
    }
  }

  return <Stack gap="xs">{elements}</Stack>;
}

interface PairCardProps {
  sendStep: ProtocolStep;
  recvStep: ProtocolStep;
  tools: Tool[];
  receiveOptions: string[];
  onUpdateStep: ProtocolStepListProps["onUpdateStep"];
  onRemoveStep: ProtocolStepListProps["onRemoveStep"];
  onConvertToChoice: ProtocolStepListProps["onConvertToChoice"];
}

function PairCard({
  sendStep,
  recvStep,
  tools,
  receiveOptions,
  onUpdateStep,
  onRemoveStep,
  onConvertToChoice,
}: PairCardProps) {
  const handleSendChange = (value: string): void => {
    onUpdateStep(sendStep.id, (s) => ({ ...s, label: value }));
    onUpdateStep(recvStep.id, (s) => ({ ...s, label: `${value}Result` }));
  };

  return (
    <PairContainer>
      <SendCard p="xs" radius={0}>
        <RowGroup>
          <Glyph c="var(--inspector-protocol-send-text)">!</Glyph>
          <LabelEditor
            value={sendStep.label ?? ""}
            options={tools.map((t) => t.name)}
            onChange={handleSendChange}
            placeholder="label"
            ariaLabel="Send label"
          />
          <ActionIcon
            variant="subtle"
            size="sm"
            onClick={() => {
              const label = sendStep.label || "Action";
              const others = tools
                .map((t) => t.name)
                .filter((n) => n !== label);
              const branches =
                others.length > 0
                  ? [label, ...others.slice(0, 2)]
                  : [label, `${label}Alt`];
              onConvertToChoice(
                sendStep.id,
                sendStep.pairId ?? "",
                "send",
                branches,
              );
            }}
            aria-label="Convert to internal choice"
            title="Convert to internal choice"
          >
            <MdCallSplit size={14} />
          </ActionIcon>
          <ActionIcon
            variant="subtle"
            size="sm"
            color="red"
            onClick={() => onRemoveStep(sendStep.id)}
            aria-label="Delete pair"
          >
            <MdDelete size={14} />
          </ActionIcon>
        </RowGroup>
      </SendCard>
      <ReceiveCard p="xs" radius={0}>
        <RowGroup>
          <Glyph c="var(--inspector-protocol-receive-text)">?</Glyph>
          <LabelEditor
            value={recvStep.label ?? ""}
            options={receiveOptions}
            onChange={(v) =>
              onUpdateStep(recvStep.id, (s) => ({ ...s, label: v }))
            }
            placeholder="response label"
            ariaLabel="Receive label"
          />
          <ActionIcon
            variant="subtle"
            size="sm"
            onClick={() => {
              const sendLabel = sendStep.label || "Action";
              onConvertToChoice(recvStep.id, recvStep.pairId ?? "", "receive", [
                `${sendLabel}Result`,
                `${sendLabel}Error`,
              ]);
            }}
            aria-label="Convert to external choice"
            title="Convert to external choice"
          >
            <MdCallSplit size={14} />
          </ActionIcon>
          <Text size="xs" c="dimmed" fs="italic">
            paired
          </Text>
        </RowGroup>
      </ReceiveCard>
    </PairContainer>
  );
}

interface StepCardProps {
  step: ProtocolStep;
  tools: Tool[];
  receiveOptions: string[];
  insertTarget: InsertTarget | null;
  onSetInsertTarget: ProtocolStepListProps["onSetInsertTarget"];
  onUpdateStep: ProtocolStepListProps["onUpdateStep"];
  onRemoveStep: ProtocolStepListProps["onRemoveStep"];
  onConvertToChoice: ProtocolStepListProps["onConvertToChoice"];
}

function StepCard({
  step,
  tools,
  receiveOptions,
  insertTarget,
  onSetInsertTarget,
  onUpdateStep,
  onRemoveStep,
  onConvertToChoice,
}: StepCardProps) {
  if (step.type === "action" && step.isRecRef) {
    return (
      <RecursionCard>
        <RowGroup>
          <Glyph c="var(--inspector-protocol-recursion-text)">
            ↻ loop → {step.recVar}
          </Glyph>
          <Group gap="xs" justify="flex-end" flex={1}>
            <ActionIcon
              variant="subtle"
              size="sm"
              color="red"
              onClick={() => onRemoveStep(step.id)}
              aria-label="Delete recursion ref"
            >
              <MdDelete size={14} />
            </ActionIcon>
          </Group>
        </RowGroup>
      </RecursionCard>
    );
  }

  if (step.type === "action") {
    const isSend = step.direction === "send";
    const Card = isSend ? SendCard : ReceiveCard;
    const options = isSend ? tools.map((t) => t.name) : receiveOptions;

    return (
      <Card>
        <RowGroup>
          <Glyph
            c={
              isSend
                ? "var(--inspector-protocol-send-text)"
                : "var(--inspector-protocol-receive-text)"
            }
          >
            {isSend ? "!" : "?"}
          </Glyph>
          <LabelEditor
            value={step.label ?? ""}
            options={options}
            onChange={(v) => onUpdateStep(step.id, (s) => ({ ...s, label: v }))}
            placeholder="label"
            ariaLabel={isSend ? "Send label" : "Receive label"}
          />
          {step.toolName ? (
            <Text size="xs" c="dimmed" truncate maw={96}>
              ({step.toolName})
            </Text>
          ) : null}
          <ActionIcon
            variant="subtle"
            size="sm"
            color="red"
            onClick={() => onRemoveStep(step.id)}
            aria-label="Delete step"
          >
            <MdDelete size={14} />
          </ActionIcon>
        </RowGroup>
      </Card>
    );
  }

  if (step.type === "choice") {
    const isSend = step.direction === "send";
    const prefixColor = isSend
      ? "var(--inspector-protocol-send-text)"
      : "var(--inspector-protocol-receive-text)";
    return (
      <ChoiceCard>
        <ChoiceHeaderRow>
          <Glyph c={prefixColor}>
            {isSend ? "!" : "?"}
            {"{"}
          </Glyph>
          <Text size="xs" c="dimmed" flex={1}>
            {isSend ? "Internal" : "External"} Choice
          </Text>
          <ActionIcon
            variant="subtle"
            size="sm"
            onClick={() =>
              onUpdateStep(step.id, (s) => ({
                ...s,
                branches: [
                  ...(s.branches ?? []),
                  {
                    id: `step-branch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    label: `Branch${String.fromCharCode(65 + (s.branches?.length ?? 0))}`,
                    steps: [],
                  },
                ],
              }))
            }
            aria-label="Add branch"
          >
            <MdAdd size={14} />
          </ActionIcon>
          <ActionIcon
            variant="subtle"
            size="sm"
            color="red"
            onClick={() => onRemoveStep(step.id)}
            aria-label="Delete choice"
          >
            <MdDelete size={14} />
          </ActionIcon>
        </ChoiceHeaderRow>
        <Stack gap="xs" px="xs" pb="xs">
          {step.branches?.map((branch) => (
            <BranchBlock
              key={branch.id}
              branch={branch}
              choiceStep={step}
              tools={tools}
              receiveOptions={receiveOptions}
              insertTarget={insertTarget}
              onSetInsertTarget={onSetInsertTarget}
              onUpdateStep={onUpdateStep}
              onRemoveStep={onRemoveStep}
              onConvertToChoice={onConvertToChoice}
              onRemoveBranch={() => {
                if ((step.branches?.length ?? 0) > 2) {
                  onUpdateStep(step.id, (s) => ({
                    ...s,
                    branches: s.branches?.filter((b) => b.id !== branch.id),
                  }));
                }
              }}
              onUpdateBranchLabel={(label) =>
                onUpdateStep(step.id, (s) => ({
                  ...s,
                  branches: s.branches?.map((b) =>
                    b.id === branch.id ? { ...b, label } : b,
                  ),
                }))
              }
            />
          ))}
        </Stack>
        <Group px="xs" pb={6}>
          <Glyph c={prefixColor}>{"}"}</Glyph>
        </Group>
      </ChoiceCard>
    );
  }

  if (step.type === "recursion") {
    return (
      <RecursionCard>
        <RowGroup>
          <Glyph c="var(--inspector-protocol-recursion-text)">rec</Glyph>
          <Glyph c="var(--inspector-protocol-recursion-text)">
            {step.recVar}
          </Glyph>
          <Glyph c="dimmed">.</Glyph>
          <Group gap="xs" justify="flex-end" flex={1}>
            <ActionIcon
              variant="subtle"
              size="sm"
              color="red"
              onClick={() => onRemoveStep(step.id)}
              aria-label="Delete recursion"
            >
              <MdDelete size={14} />
            </ActionIcon>
          </Group>
        </RowGroup>
      </RecursionCard>
    );
  }

  return null;
}

interface BranchBlockProps {
  branch: ProtocolBranch;
  choiceStep: ProtocolStep;
  tools: Tool[];
  receiveOptions: string[];
  insertTarget: InsertTarget | null;
  onSetInsertTarget: ProtocolStepListProps["onSetInsertTarget"];
  onUpdateStep: ProtocolStepListProps["onUpdateStep"];
  onRemoveStep: ProtocolStepListProps["onRemoveStep"];
  onConvertToChoice: ProtocolStepListProps["onConvertToChoice"];
  onRemoveBranch: () => void;
  onUpdateBranchLabel: (label: string) => void;
}

const BranchPaper = Paper.withProps({
  withBorder: true,
  p: 0,
  radius: "sm",
});

function BranchBlock({
  branch,
  choiceStep,
  tools,
  receiveOptions,
  insertTarget,
  onSetInsertTarget,
  onUpdateStep,
  onRemoveStep,
  onConvertToChoice,
  onRemoveBranch,
  onUpdateBranchLabel,
}: BranchBlockProps) {
  const [expanded, setExpanded] = useState(true);
  const branchTerminated = isTerminated(branch.steps);
  const isActive =
    insertTarget?.choiceStepId === choiceStep.id &&
    insertTarget?.branchId === branch.id;

  const siblingLabels = (choiceStep.branches ?? [])
    .filter((b) => b.id !== branch.id)
    .map((b) => b.label);
  const isExternal = choiceStep.direction === "receive";
  const allOptions = isExternal ? receiveOptions : tools.map((t) => t.name);
  const branchOptions = allOptions.filter((o) => !siblingLabels.includes(o));

  return (
    <BranchPaper
      bd={
        isActive
          ? "2px solid var(--inspector-protocol-target-border)"
          : undefined
      }
    >
      <Group gap="xs" px="xs" py={6} wrap="nowrap">
        <ActionIcon
          variant="subtle"
          size="xs"
          onClick={() => setExpanded(!expanded)}
          aria-label={expanded ? "Collapse branch" : "Expand branch"}
        >
          {expanded ? <MdExpandMore /> : <MdChevronRight />}
        </ActionIcon>
        <BranchLabelEditor
          value={branch.label}
          options={branchOptions}
          onChange={onUpdateBranchLabel}
        />
        {branch.steps.length > 0 ? (
          <Text size="xs" c="dimmed">
            ({branch.steps.length})
          </Text>
        ) : null}
        <ActionIcon
          variant="subtle"
          size="sm"
          c={isActive ? "var(--inspector-protocol-receive-text)" : undefined}
          onClick={() =>
            isActive
              ? onSetInsertTarget(null)
              : onSetInsertTarget({
                  choiceStepId: choiceStep.id,
                  branchId: branch.id,
                })
          }
          aria-label={
            isActive
              ? "Stop targeting this branch"
              : "Target this branch for palette insertion"
          }
        >
          <MdCenterFocusStrong size={14} />
        </ActionIcon>
        {(choiceStep.branches?.length ?? 0) > 2 ? (
          <ActionIcon
            variant="subtle"
            size="sm"
            color="red"
            onClick={onRemoveBranch}
            aria-label="Remove branch"
          >
            <MdDelete size={14} />
          </ActionIcon>
        ) : null}
      </Group>

      {expanded ? (
        <Stack gap={4} px="xs" pb="xs">
          {branch.steps.length > 0 ? (
            <ProtocolStepList
              steps={branch.steps}
              tools={tools}
              receiveOptions={receiveOptions}
              insertTarget={insertTarget}
              onSetInsertTarget={onSetInsertTarget}
              onUpdateStep={onUpdateStep}
              onRemoveStep={onRemoveStep}
              onConvertToChoice={onConvertToChoice}
            />
          ) : null}
          <Text size="xs" c="dimmed" fs="italic" px={4}>
            {branchTerminated
              ? "end"
              : isActive
                ? "Use the palette to add steps here"
                : "Click the target icon to add steps from the palette"}
          </Text>
        </Stack>
      ) : null}
    </BranchPaper>
  );
}

interface LabelEditorProps {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  placeholder: string;
  ariaLabel: string;
}

function LabelEditor({
  value,
  options,
  onChange,
  placeholder,
  ariaLabel,
}: LabelEditorProps) {
  if (options.length === 0) {
    return (
      <MonoInput
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.currentTarget.value)}
        aria-label={ariaLabel}
      />
    );
  }
  const data =
    value && !options.includes(value) ? [value, ...options] : options;
  return (
    <Select
      flex={1}
      size="xs"
      value={value || null}
      data={data}
      onChange={(v) => onChange(v ?? "")}
      placeholder={placeholder}
      allowDeselect={false}
      aria-label={ariaLabel}
    />
  );
}

interface BranchLabelEditorProps {
  value: string;
  options: string[];
  onChange: (value: string) => void;
}

function BranchLabelEditor({
  value,
  options,
  onChange,
}: BranchLabelEditorProps) {
  if (options.length === 0) {
    return (
      <MonoInput
        value={value}
        placeholder="branch label"
        onChange={(e) => onChange(e.currentTarget.value)}
        aria-label="Branch label"
      />
    );
  }
  const data = options.includes(value) ? options : [value, ...options];
  return (
    <Select
      flex={1}
      size="xs"
      value={value}
      data={data}
      onChange={(v) => onChange(v ?? "")}
      placeholder="branch label"
      allowDeselect={false}
      aria-label="Branch label"
    />
  );
}
