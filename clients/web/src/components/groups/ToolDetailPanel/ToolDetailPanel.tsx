import {
  ActionIcon,
  Button,
  Code,
  Collapse,
  Divider,
  Group,
  Image,
  ScrollArea,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { useId, useMemo, useState } from "react";
import { RiArrowDownSLine, RiArrowRightSLine } from "react-icons/ri";
import type {
  ProgressNotification,
  Tool,
  ToolAnnotations,
} from "@modelcontextprotocol/client";
import { resolveDisplayLabel } from "../../../utils/toolUtils";
import {
  hasMissingRequiredFields,
  toFormSchema,
} from "../../../utils/jsonUtils";
import { getMirroredHeaderParams } from "@inspector/core/json/xMcpHeader.js";
import { lintToolSchemas } from "@inspector/core/json/schemaLint.js";
import { AnnotationBadge } from "../../elements/AnnotationBadge/AnnotationBadge";
import { SchemaFindingsList } from "../../elements/SchemaFindingsList/SchemaFindingsList";
import { useSchemaFindingsExpanded } from "../../../hooks/useSchemaFindingsExpanded";
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
  /**
   * Identity of the selected *row*, which is not the tool name: a server may
   * repeat a name, and `ToolsScreen` disambiguates those rows with a key of its
   * own (#1957). Passed straight to `SchemaFormProps.resetKey`, so switching
   * between two same-named tools drops the first one's in-progress field text
   * and enlarged fields. Falls back to the name, which is the right answer for
   * any caller whose list cannot repeat one.
   */
  resetKey?: string;
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
  // No `type` override: the app-wide default is `type="scroll"` (see
  // `src/theme/ScrollArea.ts`), which shows the bar only while the user is
  // actually scrolling. `type="auto"` parked a permanent bar down the side of
  // every tool whose form is taller than the panel — which, now that the
  // schema-portability section opens collapsed, is the ordinary case rather
  // than the exception. `offsetScrollbars` stays: it reserves the gutter, so
  // the form does not shift sideways when the bar fades in.
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

// Header-mirroring section (SEP-2243): lists which args mirror their value into
// an `Mcp-Param-{Name}` header on `tools/call`. `Stack` (not `Box`) so the
// constant can carry props; the heading + note pin above the mapping rows.
const HeaderParamsSection = Stack.withProps({
  gap: "xs",
});

const HeaderParamsTitle = Text.withProps({
  size: "sm",
  fw: 600,
});

const HeaderParamsNote = Text.withProps({
  size: "xs",
  c: "var(--inspector-text-secondary)",
});

// One `arg → Mcp-Param-{Name}` mapping row.
const HeaderParamRow = Group.withProps({
  gap: "xs",
  wrap: "nowrap",
});

const HeaderParamArrow = Text.withProps({
  size: "sm",
  c: "var(--inspector-text-secondary)",
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
  resetKey,
}: ToolDetailPanelProps) {
  const { name, title, description, icons, annotations, inputSchema } = tool;
  // Narrow the SDK protocol schema to the form renderer's schema type.
  const formSchema = toFormSchema(inputSchema) ?? {};
  const iconSrc = icons?.[0]?.src;
  // SEP-2243: args this tool declares as `x-mcp-header` — their values mirror
  // into `Mcp-Param-{Name}` headers on a `tools/call` (#1632).
  const mirroredParams = getMirroredHeaderParams(tool);
  // Memoized on the tool: this panel re-renders on every keystroke in the
  // argument form, and the walk depends on nothing that changes in between.
  const schemaFindings = useMemo(() => lintToolSchemas(tool), [tool]);
  // Global rather than per tool, so the choice survives a tool switch — see
  // the hook. This panel is reused across selections, so per-tool state here
  // would re-open the wall on every click anyway.
  const [schemaFindingsExpanded, setSchemaFindingsExpanded] =
    useSchemaFindingsExpanded();

  // Descriptions are shown by default (most are short); the chevron lets the
  // user hide a long one to keep the form and Execute footer in view. Reset to
  // shown when switching tools (React's adjust-state-during-render pattern) so
  // a prior tool's hidden state doesn't carry over — mirrors how ToolsScreen
  // clears formValues on change.
  const [descriptionOpen, setDescriptionOpen] = useState(true);
  // Text a field is holding that it could not turn into a value — unparseable
  // JSON, or a number this client cannot send exactly. Reported by the form
  // because the draft lives inside the field and never reaches `formValues`.
  const [hasInvalidDraft, setHasInvalidDraft] = useState(false);
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

  // Two distinct reasons the arguments aren't sendable, and this panel used to
  // check neither — Execute was gated on `isExecuting` alone, so a required
  // argument left empty and a field full of unparseable text were both
  // executable, and simply arrived at the server absent (#2020).
  const executeDisabled =
    isExecuting ||
    hasMissingRequiredFields(formSchema, formValues) ||
    hasInvalidDraft;

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

          {mirroredParams.length > 0 && (
            <HeaderParamsSection>
              <HeaderParamsTitle>
                Mirrored request headers (SEP-2243)
              </HeaderParamsTitle>
              {mirroredParams.map((param) => (
                <HeaderParamRow key={param.path}>
                  <Code>{param.path}</Code>
                  <HeaderParamArrow>→</HeaderParamArrow>
                  <Code>{param.header}</Code>
                </HeaderParamRow>
              ))}
              <HeaderParamsNote>
                These argument values are mirrored into HTTP headers on the
                call. In the web client the <Code>Mcp-Param-*</Code> headers are
                applied by the Node backend that issues the upstream request.
              </HeaderParamsNote>
            </HeaderParamsSection>
          )}

          <SchemaFindingsList
            findings={schemaFindings}
            expanded={schemaFindingsExpanded}
            onExpandedChange={setSchemaFindingsExpanded}
          />

          <SchemaForm
            schema={formSchema}
            values={formValues}
            onChange={onFormChange}
            disabled={isExecuting}
            // This panel is reused across tool selections rather than
            // remounted, so the form needs a per-selection key to drop another
            // tool's in-progress field text. See SchemaFormProps.resetKey.
            resetKey={resetKey ?? name}
            onValidityChange={setHasInvalidDraft}
            // These values become `tools/call` arguments, so a raw-JSON draft the
            // client would retype is refused rather than sent as something other
            // than what the editor shows (#2171).
            enforceToolArgumentTypes
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
          disabled={executeDisabled}
          loading={isExecuting}
        >
          Execute Tool
        </Button>
        {isExecuting && <CancelButton onClick={onCancel}>Cancel</CancelButton>}
      </FooterRow>
    </PanelStack>
  );
}
