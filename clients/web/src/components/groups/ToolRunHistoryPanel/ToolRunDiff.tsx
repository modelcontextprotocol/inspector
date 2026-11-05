import { useMemo } from "react";
import { Alert, Group, ScrollArea, Stack, Text } from "@mantine/core";
import type { ToolRun } from "../../../utils/toolRunHistory";
import { formatDuration, toolRunEnvelope } from "../../../utils/toolRunHistory";
import { canonicalJson, diffLines } from "../../../utils/lineDiff";
import type { DiffLine } from "../../../utils/lineDiff";

export interface ToolRunDiffProps {
  /** The earlier run — the diff's left-hand side. */
  before: ToolRun;
  /** The later run — the diff's right-hand side. */
  after: ToolRun;
}

const DiffStack = Stack.withProps({
  gap: "xs",
});

const DiffHeaderRow = Group.withProps({
  justify: "space-between",
  gap: "xs",
});

const DiffTitle = Text.withProps({
  size: "sm",
  fw: 600,
});

const DiffDurations = Text.withProps({
  size: "xs",
  c: "dimmed",
});

// Caps the diff so a large envelope scrolls within the compare modal rather
// than growing it past the viewport.
const DiffScroll = ScrollArea.Autosize.withProps({
  mah: "60vh",
  type: "auto",
  scrollbars: "y",
  offsetScrollbars: true,
});

// The lines are a flat run of `Text` rows; a gap would break the tinted
// background into stripes, so there is none.
const DiffLines = Stack.withProps({
  gap: 0,
});

const NoDifferenceAlert = Alert.withProps({
  color: "gray",
  variant: "light",
  title: "No differences",
});

const TooLargeAlert = Alert.withProps({
  color: "yellow",
  variant: "light",
  title: "Too large to compare",
});

const DIFF_VARIANT: Record<DiffLine["kind"], string> = {
  added: "diffAdded",
  removed: "diffRemoved",
  same: "diffSame",
};

const DIFF_PREFIX: Record<DiffLine["kind"], string> = {
  added: "+ ",
  removed: "- ",
  same: "  ",
};

/**
 * Line diff of two runs of one tool (#2830): the arguments sent and the full
 * result envelope (or the rejection), rendered as key-sorted JSON so a
 * reordered key never reads as a change. Duration is shown in the header
 * rather than diffed, since it differs on every run.
 */
export function ToolRunDiff({ before, after }: ToolRunDiffProps) {
  const lines = useMemo(
    () =>
      diffLines(
        canonicalJson(toolRunEnvelope(before)),
        canonicalJson(toolRunEnvelope(after)),
      ),
    [before, after],
  );
  const changed = lines?.some((line) => line.kind !== "same") ?? false;

  return (
    <DiffStack data-testid="tool-run-diff">
      <DiffHeaderRow>
        <DiffTitle>
          Run #{before.sequence} → Run #{after.sequence}
        </DiffTitle>
        <DiffDurations>
          {formatDuration(before.durationMs)} →{" "}
          {formatDuration(after.durationMs)}
        </DiffDurations>
      </DiffHeaderRow>
      {lines === null ? (
        <TooLargeAlert>
          These two runs differ over too many lines to compare here.
        </TooLargeAlert>
      ) : !changed ? (
        <NoDifferenceAlert>
          Both runs sent the same arguments and received the same result.
        </NoDifferenceAlert>
      ) : (
        <DiffScroll>
          <DiffLines>
            {lines.map((line, index) => (
              <Text
                // Diff lines have no identity beyond their position.
                key={index}
                variant={DIFF_VARIANT[line.kind]}
                data-diff={line.kind}
              >
                {DIFF_PREFIX[line.kind]}
                {line.text}
              </Text>
            ))}
          </DiffLines>
        </DiffScroll>
      )}
    </DiffStack>
  );
}
