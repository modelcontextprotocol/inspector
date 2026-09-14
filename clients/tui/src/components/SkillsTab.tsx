/**
 * The TUI's Skills pane — the SEP-2640 catalog in a terminal (#2248).
 *
 * **Why the TUI owns a pane rather than reusing the web screen's logic.** It
 * does reuse everything that decides an answer: `checkSkillConformance`,
 * `checkSkillNameCollisions` and `verifySkills` all live in `core/` and are
 * driven identically here, so a verdict cannot differ depending on which client
 * you asked. What is local is presentation, and the terminal's constraints are
 * genuinely different — two panes in 80 columns, no colour to rely on, and a
 * keyboard rather than a pointer.
 *
 * ⚠️ **Severity is carried by a glyph as well as a colour** (`✓` / `!` / `✗`).
 * This pane is read over ssh, inside tmux, and piped through `script(1)`, where
 * colour may not survive; a row whose only signal was `red` would then be
 * indistinguishable from a clean one.
 *
 * The pane is shown only when the connected server declares the extension —
 * that gate, and the reset that leaves the tab when it goes false, live in
 * `App.tsx` because they are navigation concerns rather than this pane's.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, useInput, type Key } from "ink";
import { ScrollView, type ScrollViewRef } from "ink-scroll-view";
import type { InspectorClient } from "@inspector/core/mcp/index.js";
import { AuthRecoveryRequiredError } from "@inspector/core/auth/challenge.js";
import {
  checkSkillConformance,
  checkSkillNameCollisions,
  skillDisplayName,
  skillEntryKey,
  skillUriIdentity,
  type SkillIssue,
} from "@inspector/core/mcp/skills.js";
import {
  DYNAMIC_RESOURCES,
  type SkillEntry,
} from "@inspector/core/mcp/skillsSchemas.js";
import {
  verifySkills,
  type SkillFileReport,
  type SkillVerifyReport,
} from "@inspector/core/mcp/skillsVerification.js";
import { useSelectableList } from "../hooks/useSelectableList.js";

interface SkillsTabProps {
  skills: SkillEntry[];
  /** Pages the last `skills/list` walk took; shown so pagination is visible. */
  pageCount: number;
  /** A failed list walk, rendered in place of the list. */
  loadError?: Error | null;
  inspectorClient: InspectorClient | null;
  width: number;
  height: number;
  focusedPane?: "list" | "details" | null;
  onAuthRecoveryRequired?: (error: AuthRecoveryRequiredError) => void;
  modalOpen?: boolean;
}

/**
 * The character that leads a finding line, by severity. A terminal pane cannot
 * lean on colour alone — the Inspector is run over ssh, in tmux, and piped
 * through `script(1)` — so severity is carried by a glyph as well as a colour.
 */
const ISSUE_MARK: Record<SkillIssue["severity"], string> = {
  error: "✗",
  warning: "!",
};

const ISSUE_COLOR: Record<SkillIssue["severity"], string> = {
  error: "red",
  warning: "yellow",
};

/** Per-file verification glyph, same reasoning as {@link ISSUE_MARK}. */
const FILE_MARK: Record<string, string> = {
  verified: "✓",
  mismatch: "✗",
  unverifiable: "?",
  error: "✗",
  "read-error": "✗",
};

const FILE_COLOR: Record<string, string> = {
  verified: "green",
  mismatch: "red",
  unverifiable: "yellow",
  error: "red",
  "read-error": "red",
};

/**
 * The status line for each of the three verification outcomes.
 *
 * A `Record` over the union rather than a chain of ternaries, so adding a
 * fourth outcome is a type error here instead of a silently missing label.
 */
const VERIFY_STATUS: Record<SkillVerifyReport["outcome"], string> = {
  verified: "[Verified — Enter to re-verify]",
  incomplete: "[Verification INCOMPLETE — Enter to re-verify]",
  failed: "[Verification FAILED — Enter to re-verify]",
};

/**
 * The explanation printed under a failed file row.
 *
 * `verifySkillResource` sets `reason` for a SIZE mismatch but not for a digest
 * one — that carries `expectedDigest` / `actualDigest` instead — so a pane that
 * rendered only `reason` showed a bare `✗ notes.md` and never said why, leaving
 * the failure unactionable (Copilot). Digests are truncated because the pane is
 * 40-odd columns wide and the first bytes are enough to see that two differ;
 * the CLI report carries them in full.
 */
function failureDetail(file: SkillFileReport): string | undefined {
  if (file.reason) return file.reason;
  if (file.status !== "mismatch") return undefined;
  const short = (d: string | undefined) => (d ? `${d.slice(0, 23)}…` : "—");
  return `expected ${short(file.expectedDigest)}, got ${short(file.actualDigest)}`;
}

/** The file name a manifest URI ends in, for a list that must fit 40 columns. */
function fileNameOf(uri: string): string {
  const cut = uri.lastIndexOf("/");
  return cut === -1 ? uri : uri.slice(cut + 1);
}

/**
 * The Skills pane (SEP-2640, #2248): the catalog on the left, and on the right
 * the selected skill's frontmatter, its conformance findings, and its manifest.
 *
 * **Enter verifies.** The static checks run on every render — they are a pure
 * walk over a list already in memory — but digest verification needs the bytes,
 * so it is one `resources/read` per manifest entry and must be asked for. That
 * split is the same one the web screen makes and the same one SEP-2640 makes:
 * hosts MUST NOT retrieve a skill's files ahead of need.
 */
export function SkillsTab({
  skills,
  pageCount,
  loadError = null,
  inspectorClient,
  width,
  height,
  focusedPane = null,
  onAuthRecoveryRequired,
  modalOpen = false,
}: SkillsTabProps) {
  const visibleCount = Math.max(1, height - 7);
  const { selectedIndex, firstVisible, setSelection } = useSelectableList(
    skills.length,
    visibleCount,
    { resetWhen: skills },
  );
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  /**
   * The last verification, keyed by the **entry it was computed against**.
   *
   * Keyed rather than cleared on selection change, so moving off a skill and
   * back does not silently discard a verdict the user just paid a round trip
   * for. Keyed by a serialization of the entry rather than by its index, so a
   * refresh that reorders the list cannot show one skill's verdict under
   * another's name — and rather than by its URI alone, because a refresh can
   * replace the manifest or the frontmatter *under the same URI*, and a
   * URI-keyed verdict would then present hashes and findings computed for the
   * previous snapshot as if they described the new one (Copilot).
   *
   * The same key the web screen uses, for the same reason: re-verifying after a
   * metadata-only refresh is the cheap direction to be wrong in; showing a
   * verdict computed against a different entry is not.
   */
  const [report, setReport] = useState<{
    key: string;
    result: SkillVerifyReport;
  } | null>(null);
  const scrollViewRef = useRef<ScrollViewRef>(null);

  const selectedSkill = skills[selectedIndex] ?? null;

  const runVerify = useCallback(
    (skill: SkillEntry) => {
      if (!inspectorClient || verifying) return;
      setVerifying(true);
      setError(null);
      // The IIFE catches everything it can throw, so there is no rejection for
      // this key handler — which cannot await — to own.
      void (async () => {
        try {
          const [result] = await verifySkills(inspectorClient, [skill]);
          setReport({ key: skillEntryKey(skill), result });
        } catch (err) {
          if (err instanceof AuthRecoveryRequiredError) {
            onAuthRecoveryRequired?.(err);
            return;
          }
          /* v8 ignore start -- `verifySkills` records an ordinary read failure
             against the file it happened on and keeps walking, and it re-throws
             exactly one error, handled directly above. So nothing the call
             graph can produce reaches here; this is the guard that keeps a
             future change from becoming an unhandled rejection instead of a
             visible message. Exercising it would mean faking a throw the walk
             cannot make, which tests the fake rather than the code. */
          setError(
            err instanceof Error ? err.message : "Failed to verify skill",
          );
          /* v8 ignore stop */
        } finally {
          setVerifying(false);
        }
      })();
    },
    [inspectorClient, onAuthRecoveryRequired, verifying],
  );

  useInput(
    (input: string, key: Key) => {
      if (key.return && selectedSkill && inspectorClient) {
        runVerify(selectedSkill);
        return;
      }
      if (focusedPane === "list") {
        if (key.upArrow && selectedIndex > 0) {
          setSelection(selectedIndex - 1);
        } else if (key.downArrow && selectedIndex < skills.length - 1) {
          setSelection(selectedIndex + 1);
        }
        return;
      }
      if (focusedPane === "details") {
        if (key.upArrow) {
          scrollViewRef.current?.scrollBy(-1);
        } else if (key.downArrow) {
          scrollViewRef.current?.scrollBy(1);
        } else if (key.pageUp) {
          const viewportHeight =
            scrollViewRef.current?.getViewportHeight() || 1;
          scrollViewRef.current?.scrollBy(-viewportHeight);
        } else if (key.pageDown) {
          const viewportHeight =
            scrollViewRef.current?.getViewportHeight() || 1;
          scrollViewRef.current?.scrollBy(viewportHeight);
        }
      }
    },
    {
      isActive:
        !modalOpen && (focusedPane === "list" || focusedPane === "details"),
    },
  );

  // Reset scroll when selection changes. A genuine synchronization with an
  // external system (the ScrollView's imperative handle), not state derived
  // from a prop — so an effect is the right tool here.
  useEffect(() => {
    scrollViewRef.current?.scrollTo(0);
  }, [selectedIndex]);

  const listWidth = Math.floor(width * 0.4);
  const detailWidth = width - listWidth;
  // A name collision is a property of the LISTING, not of an entry, so it is
  // computed once here and merged into each entry's own findings — which is
  // what carries it into the row marks below as well as the detail pane.
  const collisions = checkSkillNameCollisions(skills);
  const findingsFor = (skill: SkillEntry): SkillIssue[] => {
    const collision = collisions.get(skillUriIdentity(skill.uri));
    return [...checkSkillConformance(skill), ...(collision ? [collision] : [])];
  };
  const issues = selectedSkill ? findingsFor(selectedSkill) : [];
  const activeReport =
    selectedSkill && report?.key === skillEntryKey(selectedSkill)
      ? report.result
      : null;
  const manifest =
    selectedSkill && selectedSkill.resources !== DYNAMIC_RESOURCES
      ? selectedSkill.resources
      : [];
  // Compared on normalized identity, like every other URI comparison here, so a
  // manifest entry written in an equivalent form is not reported twice.
  const manifestIdentities = new Set(
    manifest.map((resource) => skillUriIdentity(resource.uri)),
  );
  const extraReportFiles = (activeReport?.files ?? []).filter(
    (file) => !manifestIdentities.has(skillUriIdentity(file.uri)),
  );

  return (
    <Box flexDirection="row" width={width} height={height}>
      <Box
        width={listWidth}
        height={height}
        borderStyle="single"
        borderTop={false}
        borderBottom={false}
        borderLeft={false}
        borderRight={true}
        flexDirection="column"
        paddingX={1}
      >
        <Box paddingY={1}>
          <Text
            bold
            backgroundColor={focusedPane === "list" ? "yellow" : undefined}
          >
            Skills ({skills.length}
            {pageCount > 1 ? `, ${pageCount} pages` : ""})
          </Text>
        </Box>
        {loadError ? (
          <Box paddingY={1}>
            <Text color="red">{loadError.message}</Text>
          </Box>
        ) : skills.length === 0 ? (
          <Box paddingY={1}>
            <Text dimColor>No skills available</Text>
          </Box>
        ) : (
          <Box
            flexDirection="column"
            height={visibleCount}
            overflow="hidden"
            flexShrink={0}
          >
            {skills
              .slice(firstVisible, firstVisible + visibleCount)
              .map((skill, i) => {
                const index = firstVisible + i;
                const isSelected = index === selectedIndex;
                // The per-row mark is the static conformance verdict, which
                // costs nothing — it is what makes a bad skill visible in the
                // list rather than only after selecting it.
                const rowIssues = findingsFor(skill);
                const worst = rowIssues.some((it) => it.severity === "error")
                  ? "error"
                  : rowIssues.length > 0
                    ? "warning"
                    : null;
                return (
                  // Index-keyed like the manifest and finding rows, and for
                  // the same reason: a malformed listing can repeat a URI, and
                  // this pane exists to show BOTH entries — a URI key would
                  // collide them and let React drop or reuse the wrong row
                  // (Copilot).
                  <Box
                    key={`${index}:${skill.uri}`}
                    paddingY={0}
                    flexShrink={0}
                  >
                    <Text>
                      {isSelected ? "▶ " : "  "}
                      {worst ? (
                        <Text color={ISSUE_COLOR[worst]}>
                          {ISSUE_MARK[worst]}{" "}
                        </Text>
                      ) : (
                        <Text color="green">✓ </Text>
                      )}
                      {skillDisplayName(skill)}
                    </Text>
                  </Box>
                );
              })}
          </Box>
        )}
      </Box>

      <Box
        width={detailWidth}
        height={height}
        paddingX={1}
        flexDirection="column"
        overflow="hidden"
      >
        {selectedSkill ? (
          <>
            <Box flexShrink={0} paddingTop={1}>
              <Text
                bold
                backgroundColor={
                  focusedPane === "details" ? "yellow" : undefined
                }
                {...(focusedPane === "details" ? {} : { color: "cyan" })}
              >
                {skillDisplayName(selectedSkill)}
              </Text>
            </Box>

            <ScrollView ref={scrollViewRef} height={height - 5}>
              <Box marginTop={1} flexShrink={0}>
                <Text dimColor>{selectedSkill.uri}</Text>
              </Box>
              {selectedSkill.frontmatter.description && (
                <Box marginTop={1} flexShrink={0}>
                  <Text dimColor>{selectedSkill.frontmatter.description}</Text>
                </Box>
              )}

              {/* Named for the checks it actually covers. An unqualified
                  "conforms" sat directly above "Verification FAILED" in the
                  same pane and flatly contradicted it — these are the static
                  checks against the LISTING, and passing them says nothing
                  about the bytes the server serves (Copilot). Same wording
                  problem, and the same fix, as the web screen's "No structural
                  issues". */}
              <Box marginTop={1} flexShrink={0}>
                <Text bold>
                  Listing checks
                  {issues.length === 0 ? ": no structural issues" : ":"}
                </Text>
              </Box>
              {issues.map((issue, idx) => (
                <Box key={`issue-${idx}`} paddingLeft={2} flexShrink={0}>
                  <Text color={ISSUE_COLOR[issue.severity]}>
                    {ISSUE_MARK[issue.severity]} {issue.message}
                  </Text>
                </Box>
              ))}

              {/* ABOVE the manifest, because it explains the list that
                  follows: only the first N rows were fetched, and the rest
                  stay marked `·` because nobody looked at them. Below a
                  512-row manifest it would be off-screen, which is the same as
                  absent. `verifySkills` sets `incomplete` precisely so a
                  consumer can tell "not fully checked" from a real failure
                  (Copilot). */}
              {activeReport?.incomplete && (
                <>
                  <Box marginTop={1} flexShrink={0}>
                    <Text bold color="yellow">
                      Incomplete:
                    </Text>
                  </Box>
                  <Box paddingLeft={2} flexShrink={0}>
                    <Text color="yellow">{activeReport.incomplete}</Text>
                  </Box>
                </>
              )}

              <Box marginTop={1} flexShrink={0}>
                <Text bold>
                  Manifest
                  {selectedSkill.resources === DYNAMIC_RESOURCES
                    ? ': "dynamic" — no files advertised'
                    : ` (${manifest.length})`}
                </Text>
              </Box>
              {manifest.map((resource, idx) => {
                // Matched on normalized identity, like the membership test
                // just above — a raw comparison misses a report row recorded
                // under an equivalent spelling, while `extraReportFiles`
                // suppresses it as already covered, and the verdict renders
                // nowhere (Copilot).
                const fileReport = activeReport?.files.find(
                  (file) =>
                    skillUriIdentity(file.uri) ===
                    skillUriIdentity(resource.uri),
                );
                return (
                  <Box
                    key={`file-${idx}`}
                    paddingLeft={2}
                    flexShrink={0}
                    flexDirection="column"
                  >
                    <Text>
                      {fileReport ? (
                        <Text color={FILE_COLOR[fileReport.status] ?? "white"}>
                          {FILE_MARK[fileReport.status] ?? "?"}{" "}
                        </Text>
                      ) : (
                        <Text dimColor>· </Text>
                      )}
                      {fileNameOf(resource.uri)}
                      {resource.size !== undefined ? (
                        <Text dimColor> ({resource.size} B)</Text>
                      ) : null}
                    </Text>
                    {fileReport && failureDetail(fileReport) && (
                      <Box paddingLeft={4} flexShrink={0}>
                        <Text color="red">{failureDetail(fileReport)}</Text>
                      </Box>
                    )}
                  </Box>
                );
              })}

              {/* A report can carry a file the MANIFEST does not — a dynamic
                  skill has no rows at all, yet a failed read of its own
                  SKILL.md is recorded so the failure is visible. Rendering only
                  manifest rows left "Verification FAILED" with no diagnosis
                  anywhere on screen (Copilot). */}
              {extraReportFiles.length > 0 && (
                <>
                  <Box marginTop={1} flexShrink={0}>
                    <Text bold>Read failures:</Text>
                  </Box>
                  {extraReportFiles.map((file, idx) => (
                    <Box
                      key={`extra-${idx}`}
                      paddingLeft={2}
                      flexShrink={0}
                      flexDirection="column"
                    >
                      <Text>
                        <Text color={FILE_COLOR[file.status] ?? "white"}>
                          {FILE_MARK[file.status] ?? "?"}{" "}
                        </Text>
                        {fileNameOf(file.uri)}
                      </Text>
                      {failureDetail(file) && (
                        <Box paddingLeft={4} flexShrink={0}>
                          <Text color="red">{failureDetail(file)}</Text>
                        </Box>
                      )}
                    </Box>
                  ))}
                </>
              )}

              {activeReport && activeReport.frontmatter.length > 0 && (
                <>
                  <Box marginTop={1} flexShrink={0}>
                    <Text bold>Frontmatter cross-check:</Text>
                  </Box>
                  {activeReport.frontmatter.map((issue, idx) => (
                    <Box key={`fm-${idx}`} paddingLeft={2} flexShrink={0}>
                      <Text color={ISSUE_COLOR[issue.severity]}>
                        {ISSUE_MARK[issue.severity]} {issue.message}
                      </Text>
                    </Box>
                  ))}
                </>
              )}

              {error && (
                <Box marginTop={1} flexShrink={0}>
                  <Text color="red">{error}</Text>
                </Box>
              )}

              <Box marginTop={1} flexShrink={0}>
                <Text dimColor>
                  {verifying
                    ? "[Verifying…]"
                    : activeReport
                      ? // ⚠️ Switched on `outcome`, not on `ok`. `ok` stays
                        // true for an `incomplete` report — nothing checked
                        // was wrong — so an `ok`-first branch printed
                        // "Verified" for a walk the read bounds cut short and
                        // the INCOMPLETE arm was unreachable (Copilot).
                        VERIFY_STATUS[activeReport.outcome]
                      : "[Enter to verify digests and frontmatter]"}
                </Text>
              </Box>
            </ScrollView>

            {focusedPane === "details" && (
              <Box
                flexShrink={0}
                height={1}
                justifyContent="center"
                backgroundColor="gray"
              >
                <Text bold color="white">
                  ↑/↓ to scroll, Enter to verify
                </Text>
              </Box>
            )}
          </>
        ) : (
          <Box paddingY={1} flexShrink={0}>
            <Text dimColor>Select a skill to view details</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
