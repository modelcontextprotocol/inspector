import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Checkbox,
  Collapse,
  Group,
  Modal,
  Paper,
  ScrollArea,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { ContentViewer } from "../../elements/ContentViewer/ContentViewer";
import { ExpandToggle } from "../../elements/ExpandToggle/ExpandToggle";
import type { ToolRun } from "../../../utils/toolRunHistory";
import {
  formatDuration,
  toggleCompare,
  toolRunEnvelope,
} from "../../../utils/toolRunHistory";
import { canonicalJson } from "../../../utils/lineDiff";
import { ToolRunDiff } from "./ToolRunDiff";

export interface ToolRunHistoryPanelProps {
  /** The selected tool's runs this session, newest first. */
  runs: readonly ToolRun[];
  /** A call is in flight, so Re-run is disabled until it settles. */
  isExecuting: boolean;
  /** Re-send a run's arguments (and load them into the form). */
  onRerun: (run: ToolRun) => void;
}

const PanelStack = Stack.withProps({
  gap: "sm",
  miw: 0,
});

// Title over hint rather than side by side: the history shares the screen
// with the tool list, the form and the Monitor sidebar, so it is often narrow.
const HeaderStack = Stack.withProps({
  gap: 2,
});

// h2, size h4 — a panel heading level with the "Results" panel beside it.
const HistoryTitle = Title.withProps({
  order: 2,
  size: "h4",
});

const HintText = Text.withProps({
  size: "xs",
  c: "dimmed",
});

// The run list scrolls within the card once it outgrows this cap, so a long
// session's history can't push the diff (below it) out of view.
const RunListScroll = ScrollArea.Autosize.withProps({
  mah: 240,
  type: "auto",
  scrollbars: "y",
  offsetScrollbars: true,
});

const RunList = Stack.withProps({
  gap: "xs",
});

const RunCard = Paper.withProps({
  withBorder: true,
  radius: "md",
  p: "xs",
});

// Two lines per run — identity and outcome, then when/how long and the
// actions — so a narrow column wraps between them instead of clipping either.
const RunStack = Stack.withProps({
  gap: 4,
});

const RunSummary = Group.withProps({
  gap: "xs",
  wrap: "nowrap",
});

const RunDetails = Group.withProps({
  justify: "space-between",
  gap: "xs",
});

const RunActions = Group.withProps({
  gap: 4,
  wrap: "nowrap",
});

const RunLabel = Text.withProps({
  size: "sm",
  fw: 600,
  variant: "nowrap",
});

const RunMeta = Text.withProps({
  size: "xs",
  c: "dimmed",
});

const RerunButton = Button.withProps({
  size: "compact-xs",
  variant: "light",
});

const StatusBadge = Badge.withProps({
  size: "sm",
  variant: "light",
  flex: "0 0 auto",
});

const DetailScroll = ScrollArea.Autosize.withProps({
  mah: 300,
  type: "auto",
  scrollbars: "y",
  offsetScrollbars: true,
});

const HeaderRow = Group.withProps({
  justify: "space-between",
  align: "flex-start",
  gap: "xs",
});

const CompareButton = Button.withProps({
  size: "compact-sm",
  variant: "light",
});

// The diff opens in a wide modal rather than inline: the history shares a
// narrow column with the form, and a JSON diff needs the width to be legible.
const CompareModal = Modal.withProps({
  size: "xl",
  centered: true,
  title: "Compare runs",
});

function runTime(run: ToolRun): string {
  return new Date(run.startedAt).toLocaleTimeString();
}

// A run's arguments + envelope as key-sorted JSON, memoized per run.
function RunEnvelope({ run }: { run: ToolRun }) {
  const text = useMemo(() => canonicalJson(toolRunEnvelope(run)), [run]);
  return (
    <ContentViewer
      block={{ type: "text", text }}
      mimeType="application/json"
      copyable
    />
  );
}

function RunEntry({
  run,
  compared,
  isExecuting,
  onToggleCompare,
  onRerun,
}: {
  run: ToolRun;
  compared: boolean;
  isExecuting: boolean;
  onToggleCompare: () => void;
  onRerun: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const label = `Run #${run.sequence}`;
  return (
    <RunCard data-testid="tool-run">
      <RunStack>
        <RunSummary>
          <Checkbox
            aria-label={`Compare ${label}`}
            checked={compared}
            onChange={onToggleCompare}
          />
          <RunLabel>{label}</RunLabel>
          <StatusBadge color={run.status === "ok" ? "green" : "red"}>
            {run.status === "ok" ? "OK" : "Error"}
          </StatusBadge>
        </RunSummary>
        <RunDetails>
          <RunMeta>
            {runTime(run)} · {formatDuration(run.durationMs)}
          </RunMeta>
          <RunActions>
            <RerunButton
              aria-label={`Re-run ${label}`}
              disabled={isExecuting}
              onClick={onRerun}
            >
              Re-run
            </RerunButton>
            <ExpandToggle
              expanded={expanded}
              onToggle={() => setExpanded((value) => !value)}
              ariaLabel={`${expanded ? "Collapse" : "Expand"} ${label}`}
            />
          </RunActions>
        </RunDetails>
      </RunStack>
      <Collapse in={expanded}>
        <DetailScroll>
          {/* Built only once expanded: serializing every retained envelope
              on each render of a collapsed list would be wasted work. */}
          {expanded && <RunEnvelope run={run} />}
        </DetailScroll>
      </Collapse>
    </RunCard>
  );
}

/**
 * The selected tool's run history (#2830): one row per completed call with its
 * outcome, time and duration; Re-run to send the same arguments again; an
 * expandable view of the arguments and full result envelope; and a diff
 * between any two runs ticked for comparison.
 */
export function ToolRunHistoryPanel({
  runs,
  isExecuting,
  onRerun,
}: ToolRunHistoryPanelProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  // A run pruned from the history (past the per-tool cap) drops out of the
  // comparison on its own, with no effect needed to tidy the selection.
  const compared = runs.filter((run) => selectedIds.includes(run.id));
  // `runs` is newest first, so the later run of the pair is the first match.
  const [after, before] = compared;

  return (
    <PanelStack>
      <HeaderRow>
        <HeaderStack>
          <HistoryTitle>History</HistoryTitle>
          <HintText>
            {before && after
              ? `Run #${before.sequence} and Run #${after.sequence} selected`
              : "Tick two runs to compare them"}
          </HintText>
        </HeaderStack>
        <CompareButton
          disabled={!(before && after)}
          onClick={() => setCompareOpen(true)}
        >
          Compare
        </CompareButton>
      </HeaderRow>
      <RunListScroll>
        <RunList>
          {runs.map((run) => (
            <RunEntry
              key={run.id}
              run={run}
              compared={selectedIds.includes(run.id)}
              isExecuting={isExecuting}
              onToggleCompare={() =>
                setSelectedIds((prev) => toggleCompare(prev, run.id))
              }
              onRerun={() => onRerun(run)}
            />
          ))}
        </RunList>
      </RunListScroll>
      {/* Closes on its own if a ticked run is pruned while it is open. */}
      <CompareModal
        opened={compareOpen && !!before && !!after}
        onClose={() => setCompareOpen(false)}
      >
        {before && after && <ToolRunDiff before={before} after={after} />}
      </CompareModal>
    </PanelStack>
  );
}
