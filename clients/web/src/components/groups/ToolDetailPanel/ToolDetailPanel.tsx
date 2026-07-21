import {
  ActionIcon,
  Button,
  Collapse,
  Divider,
  Group,
  Image,
  ScrollArea,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { useId, useState } from "react";
import { RiArrowDownSLine, RiArrowRightSLine } from "react-icons/ri";
import type {
  ProgressNotification,
  Tool,
  ToolAnnotations,
} from "@modelcontextprotocol/client";
import { resolveDisplayLabel } from "../../../utils/toolUtils";
import { toFormSchema } from "../../../utils/jsonUtils";
import { AnnotationBadge } from "../../elements/AnnotationBadge/AnnotationBadge";
import { ProgressDisplay } from "../../elements/ProgressDisplay/ProgressDisplay";
import { SchemaForm } from "../SchemaForm/SchemaForm";

export type ToolProgress = Pick<
  ProgressNotification["params"],
  "progress" | "total" | "message"
>;

export interface ToolDetailPanelProps {
  tool: Tool;
  formValues: Record<string, unknown>;
  isExecuting: boolean;
  progress?: ToolProgress;
  /** Whether the connected server advertises task-augmented tool calls. */
  serverSupportsTaskToolCalls: boolean;
  /**
   * Modern (2026-07-28) connection with the `io.modelcontextprotocol/tasks`
   * extension negotiated (SEP-2663). Task creation is server-directed there, so
   * "Run as task" is offered for ANY tool (not just ones declaring per-tool
   * `taskSupport`, which is the legacy mechanism). Defaults to false (legacy).
   */
  modernTasks?: boolean;
  /** User's "Run as task" preference (meaningful for `optional` tools and, on
   * modern connections, any tool). */
  runAsTask: boolean;
  onRunAsTaskChange: (value: boolean) => void;
  onFormChange: (values: Record<string, unknown>) => void;
  /** Receives the effective run-as-task decision for this execution. */
  onExecute: (runAsTask: boolean) => void;
  onCancel: () => void;
}

// Outer column: title/annotations pin at top, the Execute footer pins at the
// bottom, and the middle (description + form + progress) scrolls when the
// enclosing card hits its `mah`. `mih: 0` lets the flex children shrink.
const PanelStack = Stack.withProps({
  gap: "md",
  miw: 0,
  mih: 0,
});

const PinnedHeader = Stack.withProps({
  gap: "md",
  flex: "0 0 auto",
});

// `0 1 auto` + `mih: 0`: shrinks to the available space and scrolls; a short
// form doesn't reserve extra height, keeping Execute snug below it.
const BodyScroll = ScrollArea.withProps({
  flex: "0 1 auto",
  miw: 0,
  mih: 0,
  type: "auto",
  scrollbars: "y",
  offsetScrollbars: true,
});

const BodyStack = Stack.withProps({
  gap: "md",
});

// Left-aligned (Execute first, Cancel after) so the primary action sits closest
// to the sidebar controls / the form fields above — shortest pointer travel.
const FooterRow = Group.withProps({
  justify: "flex-start",
  flex: "0 0 auto",
});

const TitleRow = Group.withProps({
  gap: "sm",
  wrap: "nowrap",
  align: "center",
  miw: 0,
});

const ToolIcon = Image.withProps({
  w: 24,
  h: 24,
  fit: "contain",
});

// `flex: 1` lets the title absorb the row's slack so the chevron toggle pins
// to the right edge of the (nowrap) TitleRow.
const ToolTitle = Text.withProps({
  fw: 700,
  size: "lg",
  truncate: "end",
  flex: 1,
});

// Chevron toggle for the collapsible description, pinned to the right of the
// title row. `aria-label` is set per-render since it reflects the open state.
const DescriptionToggle = ActionIcon.withProps({
  variant: "subtle",
  color: "gray",
  size: "sm",
});

const DescriptionText = Text.withProps({
  size: "sm",
  c: "dimmed",
});

const CancelButton = Button.withProps({
  variant: "subtle",
  color: "red",
});

// Left-aligned row hosting the "Run as task" toggle, above the execute footer.
const TaskToggleRow = Group.withProps({
  justify: "flex-start",
  flex: "0 0 auto",
});

const RunAsTaskSwitch = Switch.withProps({
  size: "sm",
  label: "Run as task",
});

// A tool's per-tool task support, defaulting to "forbidden" (the SDK default
// when `execution` is absent) so tools that say nothing can't be run as tasks.
type TaskSupport = "forbidden" | "optional" | "required";
function getTaskSupport(tool: Tool): TaskSupport {
  return tool.execution?.taskSupport ?? "forbidden";
}

function hasAnyAnnotation(annotations?: ToolAnnotations): boolean {
  return !!(
    annotations &&
    (annotations.readOnlyHint ||
      annotations.destructiveHint ||
      annotations.idempotentHint ||
      annotations.openWorldHint)
  );
}

export function ToolDetailPanel({
  tool,
  formValues,
  isExecuting,
  progress,
  serverSupportsTaskToolCalls,
  modernTasks = false,
  runAsTask,
  onRunAsTaskChange,
  onFormChange,
  onExecute,
  onCancel,
}: ToolDetailPanelProps) {
  const { name, title, description, icons, annotations, inputSchema } = tool;
  // Narrow the SDK protocol schema to the form renderer's schema type.
  const formSchema = toFormSchema(inputSchema) ?? {};
  const iconSrc = icons?.[0]?.src;

  // Descriptions are shown by default (most are short); the chevron lets the
  // user hide a long one to keep the form and Execute footer in view. Reset to
  // shown when switching tools (React's adjust-state-during-render pattern) so
  // a prior tool's hidden state doesn't carry over — mirrors how ToolsScreen
  // clears formValues on change.
  const [descriptionOpen, setDescriptionOpen] = useState(true);
  const [prevToolName, setPrevToolName] = useState(name);
  if (name !== prevToolName) {
    setPrevToolName(name);
    setDescriptionOpen(true);
  }
  // Ties the toggle to the Collapse region so assistive tech announces it as a
  // single expandable control (aria-expanded + aria-controls).
  const descriptionRegionId = useId();

  // Show the toggle when the server supports task tool calls and either the
  // connection is modern (task creation is server-directed there, so any tool
  // may become a task) or the tool doesn't forbid per-tool task support
  // (legacy). `required` tools are forced on (checked + disabled); `optional`
  // and (on modern) any tool follow the user's `runAsTask` choice.
  //
  // NOTE: on modern, a per-tool `taskSupport: "forbidden"` is DELIBERATELY
  // ignored. Under SEP-2663 task creation is decided by the server per request,
  // not declared per tool, so `taskSupport` (a legacy 2025-11-25 concept) does
  // not gate the affordance — the server may return a task for any call. The
  // toggle just declares intent to poll a returned handle.
  const taskSupport = getTaskSupport(tool);
  const showRunAsTask =
    serverSupportsTaskToolCalls && (modernTasks || taskSupport !== "forbidden");
  // Gate the effective decision on `showRunAsTask`: a stale `runAsTask`/`required`
  // value must not route through callToolStream when the toggle is hidden. On
  // legacy, a tool's taskSupport is only considered when the server advertises
  // `tasks.requests.tools.call`; on modern, the user's choice governs any tool.
  const effectiveRunAsTask =
    showRunAsTask &&
    (taskSupport === "required" ||
      ((taskSupport === "optional" || modernTasks) && runAsTask));

  return (
    <PanelStack>
      <PinnedHeader>
        <TitleRow>
          {iconSrc && <ToolIcon src={iconSrc} alt="" />}
          <ToolTitle>{resolveDisplayLabel(name, title)}</ToolTitle>
          {description && (
            <DescriptionToggle
              aria-label={
                descriptionOpen ? "Hide description" : "Show description"
              }
              aria-expanded={descriptionOpen}
              aria-controls={descriptionRegionId}
              onClick={() => setDescriptionOpen((open) => !open)}
            >
              {descriptionOpen ? <RiArrowDownSLine /> : <RiArrowRightSLine />}
            </DescriptionToggle>
          )}
        </TitleRow>
        {hasAnyAnnotation(annotations) && annotations && (
          <Group gap="xs">
            {annotations.readOnlyHint && (
              <AnnotationBadge facet="readOnlyHint" value={true} />
            )}
            {annotations.destructiveHint && (
              <AnnotationBadge facet="destructiveHint" value={true} />
            )}
            {annotations.idempotentHint && (
              <AnnotationBadge facet="idempotentHint" value={true} />
            )}
            {annotations.openWorldHint && (
              <AnnotationBadge facet="openWorldHint" value={true} />
            )}
          </Group>
        )}
      </PinnedHeader>

      <BodyScroll>
        <BodyStack>
          {description && (
            <Collapse in={descriptionOpen} id={descriptionRegionId}>
              <DescriptionText>{description}</DescriptionText>
            </Collapse>
          )}

          <Divider />

          <SchemaForm
            schema={formSchema}
            values={formValues}
            onChange={onFormChange}
            disabled={isExecuting}
          />

          {progress && <ProgressDisplay params={progress} />}
        </BodyStack>
      </BodyScroll>

      {showRunAsTask && (
        <TaskToggleRow>
          <RunAsTaskSwitch
            checked={effectiveRunAsTask}
            disabled={isExecuting || taskSupport === "required"}
            onChange={(event) => onRunAsTaskChange(event.currentTarget.checked)}
          />
        </TaskToggleRow>
      )}

      <FooterRow>
        <Button
          size="md"
          onClick={() => onExecute(effectiveRunAsTask)}
          disabled={isExecuting}
          loading={isExecuting}
        >
          Execute Tool
        </Button>
        {isExecuting && <CancelButton onClick={onCancel}>Cancel</CancelButton>}
      </FooterRow>
    </PanelStack>
  );
}
