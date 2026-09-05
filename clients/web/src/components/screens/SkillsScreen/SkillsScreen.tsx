import { useCallback, useMemo, useRef, useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Card,
  Code,
  Flex,
  Group,
  NavLink,
  ScrollArea,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { MdRefresh, MdSearch, MdVerifiedUser } from "react-icons/md";
import type {
  SkillEntry,
  SkillResource,
} from "@inspector/core/mcp/skillsSchemas.js";
import { DYNAMIC_RESOURCES } from "@inspector/core/mcp/skillsSchemas.js";
import {
  checkSkillConformance,
  skillDisplayName,
  skillEntriesMatch,
  totalSkillBytes,
  verifySkillResource,
  type SkillIssue,
  type SkillVerification,
} from "@inspector/core/mcp/skills.js";
import { ContentViewer } from "../../elements/ContentViewer/ContentViewer";
import { useValueChange } from "../../../hooks/useValueChange";
import {
  skillFileBytes,
  type SkillFileContents,
} from "../../../utils/skillFileBytes";

/**
 * How many skill files are read at once by "Verify all". A conforming manifest
 * may hold 512 entries, so this is what keeps one click from becoming 512
 * simultaneous `resources/read` calls.
 */
const VERIFY_CONCURRENCY = 4;

/**
 * Per-row verification progress. `attempt` is the click that produced it: two
 * verifications of the SAME row in the SAME manifest (a double click, or a row
 * button pressed while "Verify all" is running) are not distinguished by the
 * manifest key, so without it an older read finishing last would overwrite the
 * newer verdict and leave the UI reporting bytes it no longer fetched.
 */
type FileState = { attempt: number } & (
  | { status: "pending" }
  | { status: "done"; verification: SkillVerification }
  | { status: "error"; message: string }
);

/**
 * Verification verdicts plus the manifest they belong to. Rows are keyed by
 * their **index**, not their URI: the conformance checker deliberately tolerates
 * a duplicated URI so it can report `duplicate-resource`, and a URI key would
 * collide those two rows into one verdict.
 */
interface VerificationState {
  /**
   * The manifest these verdicts belong to, or `null` before anything has been
   * verified. `useValueChange` deliberately does not fire on the first render,
   * so `null` stands in for "the initial manifest, not yet adopted" — the first
   * write claims it. Once set it is only ever replaced by an invalidation, so a
   * stale continuation can never be mistaken for an initial one.
   */
  key: string | null;
  files: Record<number, FileState>;
}

/**
 * The SKILL.md preview, plus the manifest it belongs to (`null` as above) and
 * the click that produced it. The manifest key cannot order two reads issued
 * for the SAME manifest, so without `attempt` a double click whose older read
 * finishes last would replace the newer preview.
 */
interface PreviewState {
  key: string | null;
  attempt?: number;
  contents?: SkillFileContents;
  message?: string;
}

/**
 * The result of the on-demand `skills/get`, plus the manifest it belongs to.
 * `matches` records whether the fetched entry describes the same skill as the
 * one `skills/list` returned — the reason for making the call at all.
 */
interface FetchedEntryState {
  key: string | null;
  /** The click this result belongs to — see {@link PreviewState.attempt}. */
  attempt?: number;
  entry?: SkillEntry;
  matches?: boolean;
  message?: string;
}

export interface SkillsScreenProps {
  skills: SkillEntry[];
  /** Pages the last `skills/list` walk took; shown so pagination is visible. */
  pageCount: number;
  /** A failed list walk, rendered above the sidebar list. */
  loadError?: Error | null;
  ui: SkillsUiState;
  onUiChange: (next: SkillsUiState) => void;
  onRefreshList: () => void;
  /** Fetch one skill file's contents via `resources/read`, on demand. */
  onReadSkillFile: (uri: string) => Promise<SkillFileContents>;
  /**
   * Re-fetch the selected entry through `skills/get` (SEP-2640). Distinct from
   * the entry `skills/list` already returned, and the point of exercising it is
   * that the two must agree: a server whose `skills/get` disagrees with its own
   * listing is broken in a way only a side-by-side fetch can show.
   */
  onGetSkill: (uri: string) => Promise<SkillEntry>;
}

/**
 * Selection and the sidebar search — controlled by the parent (App) as one
 * object so they persist across tab navigation within a live session (#1417).
 * Verification results stay local to the screen: they are derived from a live
 * `resources/read` round trip that is torn down with the screen, so persisting
 * them would restore a verdict without the fetch that produced it.
 */
export interface SkillsUiState {
  selectedSkillUri?: string;
  search: string;
}

const ScreenLayout = Flex.withProps({
  variant: "screen",
  h: "calc(100dvh - var(--app-shell-header-height, 0px) - var(--app-shell-footer-height, 0px))",
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

const DetailCard = Card.withProps({
  withBorder: true,
  padding: "lg",
  flex: 1,
  h: "100%",
});

const DetailScroll = ScrollArea.withProps({
  type: "auto",
  scrollbars: "y",
  offsetScrollbars: true,
  h: "100%",
});

const EmptyState = Text.withProps({
  c: "dimmed",
  ta: "center",
  py: "xl",
});

const ControlsRow = Group.withProps({
  justify: "space-between",
  wrap: "nowrap",
  gap: "sm",
});

// The Resources header carries three action buttons beside its count badge, so
// it wraps rather than truncating the badge on a narrow detail pane — unlike
// the sidebar row above, where the search field is meant to absorb the space.
const SectionControlsRow = Group.withProps({
  justify: "space-between",
  wrap: "wrap",
  gap: "sm",
});

const SearchInput = TextInput.withProps({
  size: "xs",
  flex: 1,
  leftSection: <MdSearch aria-hidden size={14} />,
});

const RefreshButton = Button.withProps({
  variant: "subtle",
  size: "compact-xs",
  leftSection: <MdRefresh aria-hidden size={14} />,
});

const VerifyButton = Button.withProps({
  variant: "light",
  size: "compact-sm",
  leftSection: <MdVerifiedUser aria-hidden size={14} />,
});

// A `Text` renders a `<p>`, so a section heading must never *wrap* the count
// badge beside it — a `<div>` inside a `<p>` is invalid HTML that React reports
// as a hydration error and the Storybook run fails on. Heading and badge sit
// side by side in an `InlineRow` instead.
const SectionHeading = Text.withProps({
  fw: 600,
  size: "sm",
});

const MonoCaption = Text.withProps({
  size: "xs",
  c: "dimmed",
  ff: "monospace",
});

const DetailStack = Stack.withProps({
  gap: "md",
});

const IssueStack = Stack.withProps({
  gap: "xs",
});

const ManifestTable = Table.withProps({
  striped: true,
  withTableBorder: true,
  fz: "xs",
  verticalSpacing: "xs",
});

const CountBadge = Badge.withProps({
  size: "xs",
  variant: "light",
});

// A tight, non-wrapping row — used for the detail-pane action pair and for the
// badge + Verify button inside a manifest cell.
const InlineRow = Group.withProps({
  gap: "xs",
  wrap: "nowrap",
});

const RowVerifyButton = Button.withProps({
  variant: "subtle",
  size: "compact-xs",
});

const SkillTitle = Text.withProps({
  fw: 600,
  size: "lg",
  truncate: true,
});

/** Colour token for a finding's severity — errors read as failures. */
function issueColor(issue: SkillIssue): string {
  return issue.severity === "error" ? "red" : "yellow";
}

/** Colour token for a per-file verification verdict. */
function verificationColor(status: SkillVerification["status"]): string {
  if (status === "verified") return "green";
  if (status === "mismatch") return "red";
  return "yellow";
}

/**
 * The short label a manifest row shows for its verdict. `—` (not yet run) is
 * deliberately distinct from `unverifiable` (run, but nothing to compare
 * against): conflating them would hide the fact that a server advertised no
 * digest.
 */
function verificationLabel(state: FileState | undefined): string {
  if (!state) return "—";
  if (state.status === "pending") return "checking…";
  if (state.status === "error") return "read failed";
  return state.verification.status;
}

/**
 * Whether a settled request should be discarded: its manifest was invalidated
 * (a different key), or a later click for the same manifest already wrote (a
 * higher attempt). A `null` key is the un-adopted initial manifest, which the
 * first write claims.
 */
function isStale(
  held: { key: string | null; attempt?: number },
  key: string,
  attempt: number,
): boolean {
  if (held.key !== null && held.key !== key) return true;
  return held.attempt !== undefined && held.attempt > attempt;
}

/** `sha256:abcd…wxyz`, so a long digest stays readable in a table cell. */
function shortDigest(digest: string | undefined): string {
  if (!digest) return "—";
  return digest.length <= 24 ? digest : `${digest.slice(0, 16)}…`;
}

/**
 * The Skills screen (SEP-2640) — a conformance view, not just a list.
 *
 * The sidebar lists the skills the server enumerated; the detail pane shows the
 * entry's frontmatter, every conformance finding
 * (`checkSkillConformance`), and the resource manifest with a per-file
 * verification verdict. Verification is on demand: SEP-2640 says a
 * `resources/read` of a skill file is not a load and confers no standing, so
 * the Inspector fetches only what the user asks it to.
 */
export function SkillsScreen({
  skills,
  pageCount,
  loadError,
  ui,
  onUiChange,
  onRefreshList,
  onReadSkillFile,
  onGetSkill,
}: SkillsScreenProps) {
  const { selectedSkillUri, search } = ui;
  // Both slices carry the manifest key they belong to, and every async
  // continuation writes through a functional update that compares it. That is
  // what discards a read still in flight when the selection changes or a
  // Refresh replaces the manifest — without it, a slow fetch lands afterwards
  // and writes a verdict for content nobody is looking at, or one that was
  // never checked. Storing the key IN the state (rather than bumping a ref
  // during render) keeps the `useValueChange` callback to `setState` calls
  // only, which is the purity that hook documents and requires.
  const [verification, setVerification] = useState<VerificationState>({
    key: null,
    files: {},
  });
  const [previewState, setPreviewState] = useState<PreviewState>({ key: null });
  const [fetchedEntry, setFetchedEntry] = useState<FetchedEntryState>({
    key: null,
  });
  // Every "Verify all" batch in flight, keyed by the manifest it belongs to.
  //
  // A **map**, not one slot, and the reason is a bug a single slot really had:
  // batches on different skills genuinely overlap, so a slot remembers only the
  // most recent one. Start A, switch to B and start B, return to A — the slot
  // now says B, A's button reads as free, and clicking it starts a SECOND pool
  // of workers for A on top of the first, doubling the concurrency cap. Keyed
  // by manifest, A stays disabled for exactly as long as A's batch runs.
  //
  // The value is the invocation's token, so a finalizer deletes only its own
  // entry; and a per-manifest entry is what keeps a hung batch on one skill
  // from disabling every other skill's button.
  const [batches, setBatches] = useState<ReadonlyMap<string, number>>(
    () => new Map(),
  );
  // Monotonic attempt token, shared by every on-demand action here: a manifest
  // row's verification, the SKILL.md preview, and the `skills/get` fetch. One
  // counter rather than three because it only has to be *increasing*, and each
  // consumer compares it against its own slot. A ref because it is claimed
  // inside an event handler, never during render.
  const nextAttempt = useRef(0);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return skills;
    return skills.filter(
      (skill) =>
        skillDisplayName(skill).toLowerCase().includes(needle) ||
        skill.uri.toLowerCase().includes(needle),
    );
  }, [skills, search]);

  const selected = useMemo(
    () => skills.find((skill) => skill.uri === selectedSkillUri),
    [skills, selectedSkillUri],
  );

  const issues = useMemo(
    () => (selected ? checkSkillConformance(selected) : []),
    [selected],
  );

  const manifest: SkillResource[] = useMemo(
    () =>
      selected && selected.resources !== DYNAMIC_RESOURCES
        ? selected.resources
        : [],
    [selected],
  );

  // What every result on screen is a result *about*: the selected skill entry,
  // in full. Keying on the URI alone would leave a green `verified` badge
  // attached to a digest a Refresh replaced; keying on the manifest alone would
  // leave a stale "skills/get matches skills/list" verdict after a
  // metadata-only change, since that comparison covers `frontmatter` too.
  // Re-verifying after a metadata-only refresh is the cheap direction to be
  // wrong in; showing a match that was computed against a different entry is
  // not. A primitive string, because `useValueChange` compares with `Object.is`
  // and a fresh object every render would loop.
  const manifestKey = useMemo(
    () => (selected ? JSON.stringify(selected) : (selectedSkillUri ?? "")),
    [selected, selectedSkillUri],
  );

  // Adjusted DURING RENDER via `useValueChange` rather than in an effect, so a
  // new selection (or a refreshed manifest) never paints a frame carrying the
  // previous one's verification results. `setState` calls only — the hook
  // replays this callback whenever React replays the render.
  useValueChange(manifestKey, (next) => {
    setVerification({ key: next, files: {} });
    setPreviewState({ key: next });
    setFetchedEntry({ key: next });
  });

  const fileStates = verification.key === manifestKey ? verification.files : {};

  /**
   * Verify one manifest ROW. Keyed by row index, not by URI: the checker
   * deliberately tolerates a duplicated URI so it can report
   * `duplicate-resource`, and two rows sharing a key would share one verdict —
   * verifying either would update both, and "Verify all" would race two
   * different digest/size declarations into the same slot.
   */
  const verifyRow = useCallback(
    async (index: number, resource: SkillResource, key: string) => {
      // Claimed synchronously, so two verifications of this row are ordered
      // before either read starts.
      const attempt = (nextAttempt.current += 1);
      const write = (state: FileState) =>
        setVerification((prev) => {
          // `null` is the un-adopted initial manifest; any other mismatch is a
          // continuation from a manifest that has since been invalidated.
          if (prev.key !== null && prev.key !== key) return prev;
          const files = prev.key === key ? prev.files : {};
          // A newer attempt for this row already wrote — an older read
          // finishing last must not overwrite it.
          const held = files[index];
          if (held !== undefined && held.attempt > attempt) return prev;
          return { key, files: { ...files, [index]: state } };
        });
      write({ attempt, status: "pending" });
      try {
        const contents = await onReadSkillFile(resource.uri);
        const result = await verifySkillResource(
          resource,
          skillFileBytes(contents),
        );
        write({ attempt, status: "done", verification: result });
      } catch (err) {
        write({
          attempt,
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [onReadSkillFile],
  );

  const verifyAll = useCallback(() => {
    // Bounded concurrency, not `Promise.all` over the whole manifest: a
    // conforming skill may declare 512 files, and firing 512 simultaneous
    // `resources/read` calls would bury the transport and the server for no
    // gain. Workers pull from a shared cursor so each row still flips to
    // `checking…` and then to its verdict as it lands, rather than all at once.
    //
    // Held rather than floated: each `verifyFile` owns its own failures (it
    // records them as per-row state), and this handler cannot be async, so the
    // settled promise is discarded explicitly at one place instead of per file.
    let next = 0;
    const key = manifestKey;
    const worker = async (): Promise<void> => {
      for (let i = next++; i < manifest.length; i = next++) {
        await verifyRow(i, manifest[i], key);
      }
    };
    const workers = Math.min(VERIFY_CONCURRENCY, manifest.length);
    const token = (nextAttempt.current += 1);
    setBatches((prev) => new Map(prev).set(key, token));
    // The concurrency cap is per invocation, so without the button being
    // disabled below, a second click would start a second pool of four and a
    // third would make it twelve — the flood the cap exists to prevent.
    void Promise.all(Array.from({ length: workers }, () => worker())).finally(
      // Clears only ITS OWN invocation: matched on the token as well as the
      // key, so an earlier batch settling cannot free a button a later one is
      // holding.
      () =>
        setBatches((prev) => {
          if (prev.get(key) !== token) return prev;
          const next = new Map(prev);
          next.delete(key);
          return next;
        }),
    );
  }, [manifest, manifestKey, verifyRow]);

  const showSkillMd = useCallback(() => {
    if (!selected) return;
    const key = manifestKey;
    const attempt = (nextAttempt.current += 1);
    // A click handler cannot await, and this chain terminates in its own
    // `catch` that surfaces the message in the preview slot. Both arms go
    // through `writePreview`, which drops a result whose manifest has been
    // invalidated OR whose click has been superseded.
    const writePreview = (next: Omit<PreviewState, "key" | "attempt">) =>
      setPreviewState((prev) =>
        isStale(prev, key, attempt) ? prev : { key, attempt, ...next },
      );
    void onReadSkillFile(selected.uri)
      .then((contents) => writePreview({ contents }))
      .catch((err: unknown) => {
        writePreview({
          message: err instanceof Error ? err.message : String(err),
        });
      });
  }, [manifestKey, onReadSkillFile, selected]);

  const fetchEntry = useCallback(() => {
    if (!selected) return;
    const key = manifestKey;
    const attempt = (nextAttempt.current += 1);
    // Same shape as the SKILL.md read: a click handler cannot await, the chain
    // ends in its own `catch`, and both arms drop a result whose manifest has
    // been invalidated or whose click has been superseded.
    const writeFetched = (next: Omit<FetchedEntryState, "key" | "attempt">) =>
      setFetchedEntry((prev) =>
        isStale(prev, key, attempt) ? prev : { key, attempt, ...next },
      );
    void onGetSkill(selected.uri)
      .then((entry) => {
        // Compared semantically against what `skills/list` advertised — see
        // `skillEntriesMatch` for why a `JSON.stringify` comparison would
        // report key order and manifest order as differences.
        writeFetched({ entry, matches: skillEntriesMatch(entry, selected) });
      })
      .catch((err: unknown) => {
        writeFetched({
          message: err instanceof Error ? err.message : String(err),
        });
      });
  }, [manifestKey, onGetSkill, selected]);

  const fetched = fetchedEntry.key === manifestKey ? fetchedEntry : undefined;
  const batchRunning = batches.has(manifestKey);

  const preview =
    previewState.key === manifestKey ? previewState.contents : undefined;
  const previewError =
    previewState.key === manifestKey ? previewState.message : undefined;

  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.length - errorCount;

  return (
    // `data-*` readiness contract for the headless tab smoke (#2148); see
    // clients/web/README.md#core-tab-automation-contract.
    <ScreenLayout
      data-testid="skills-screen"
      data-skill-count={skills.length}
      data-skill-page-count={pageCount}
    >
      <Sidebar>
        <SidebarCard>
          <Stack gap="sm">
            <ControlsRow>
              <SearchInput
                aria-label="Search skills"
                placeholder="Search skills"
                value={search}
                onChange={(event) =>
                  onUiChange({ ...ui, search: event.currentTarget.value })
                }
              />
              <RefreshButton onClick={onRefreshList}>Refresh</RefreshButton>
            </ControlsRow>
            {loadError && (
              <Alert color="red" title="Could not load skills">
                {loadError.message}
              </Alert>
            )}
            {filtered.length === 0 ? (
              <EmptyState>No skills</EmptyState>
            ) : (
              filtered.map((skill) => {
                const skillIssues = checkSkillConformance(skill);
                const errors = skillIssues.filter(
                  (i) => i.severity === "error",
                ).length;
                return (
                  <NavLink
                    key={skill.uri}
                    active={skill.uri === selectedSkillUri}
                    label={skillDisplayName(skill)}
                    description={skill.uri}
                    onClick={() =>
                      onUiChange({ ...ui, selectedSkillUri: skill.uri })
                    }
                    rightSection={
                      skillIssues.length > 0 ? (
                        <CountBadge color={errors > 0 ? "red" : "yellow"}>
                          {skillIssues.length}
                        </CountBadge>
                      ) : undefined
                    }
                  />
                );
              })
            )}
            <MonoCaption>
              {skills.length} skill(s) over {pageCount} page(s)
            </MonoCaption>
          </Stack>
        </SidebarCard>
      </Sidebar>

      <DetailCard>
        {!selected ? (
          <EmptyState>Select a skill to view details</EmptyState>
        ) : (
          <DetailScroll>
            <DetailStack data-testid="skill-detail">
              <Stack gap={4}>
                <SkillTitle>{skillDisplayName(selected)}</SkillTitle>
                <MonoCaption>{selected.uri}</MonoCaption>
              </Stack>

              {selected.frontmatter.description && (
                <Text size="sm">{selected.frontmatter.description}</Text>
              )}

              <Stack gap="xs">
                <InlineRow>
                  <SectionHeading>Conformance</SectionHeading>
                  <CountBadge color={errorCount > 0 ? "red" : "green"}>
                    {errorCount} error(s), {warningCount} warning(s)
                  </CountBadge>
                </InlineRow>
                {issues.length === 0 ? (
                  <Alert color="green" title="Conforms">
                    No structural issues found in this entry.
                  </Alert>
                ) : (
                  <IssueStack data-testid="skill-issues">
                    {issues.map((issue, index) => (
                      <Alert
                        // The index is load-bearing, not decoration: a manifest
                        // repeating one URI three times yields three
                        // `duplicate-resource` findings with identical code and
                        // URI, and a key built from those alone would make
                        // React drop the extras — hiding findings in exactly
                        // the malformed input this view exists to inspect.
                        key={`${index}:${issue.code}:${issue.resourceUri ?? ""}`}
                        color={issueColor(issue)}
                        title={issue.code}
                      >
                        <Stack gap={2}>
                          <Text size="sm">{issue.message}</Text>
                          {issue.resourceUri && (
                            <MonoCaption>{issue.resourceUri}</MonoCaption>
                          )}
                        </Stack>
                      </Alert>
                    ))}
                  </IssueStack>
                )}
              </Stack>

              <Stack gap="xs">
                <SectionControlsRow>
                  <InlineRow>
                    <SectionHeading>Resources</SectionHeading>
                    <CountBadge>
                      {manifest.length} file(s), {totalSkillBytes(manifest)}{" "}
                      bytes
                    </CountBadge>
                  </InlineRow>
                  <InlineRow>
                    <VerifyButton onClick={fetchEntry}>
                      Fetch with skills/get
                    </VerifyButton>
                    <VerifyButton onClick={showSkillMd}>
                      View SKILL.md
                    </VerifyButton>
                    <VerifyButton
                      onClick={verifyAll}
                      disabled={manifest.length === 0 || batchRunning}
                      loading={batchRunning}
                    >
                      Verify all
                    </VerifyButton>
                  </InlineRow>
                </SectionControlsRow>
                {selected.resources === DYNAMIC_RESOURCES ? (
                  <Alert color="yellow" title="Dynamic resources">
                    This skill declares{" "}
                    <Code>resources: &quot;dynamic&quot;</Code> — its files are
                    generated, so no manifest is advertised and integrity cannot
                    be verified.
                  </Alert>
                ) : (
                  <ManifestTable data-testid="skill-manifest">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>URI</Table.Th>
                        <Table.Th>Size</Table.Th>
                        <Table.Th>Digest</Table.Th>
                        <Table.Th>Verification</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {manifest.map((resource, index) => {
                        const state = fileStates[index];
                        const color =
                          state?.status === "done"
                            ? verificationColor(state.verification.status)
                            : state?.status === "error"
                              ? "red"
                              : "gray";
                        return (
                          // Index-keyed for the same reason the verdicts are:
                          // a duplicated URI is a case this screen reports, so
                          // it must not also collide two rows into one.
                          <Table.Tr key={index}>
                            <Table.Td>{resource.uri}</Table.Td>
                            <Table.Td>{resource.size ?? "—"}</Table.Td>
                            <Table.Td>{shortDigest(resource.digest)}</Table.Td>
                            <Table.Td>
                              <InlineRow>
                                <CountBadge color={color}>
                                  {verificationLabel(state)}
                                </CountBadge>
                                <RowVerifyButton
                                  // A click handler cannot await, and
                                  // `verifyFile` owns its own failures — it
                                  // records them as this row's state.
                                  onClick={() =>
                                    void verifyRow(index, resource, manifestKey)
                                  }
                                >
                                  Verify
                                </RowVerifyButton>
                              </InlineRow>
                            </Table.Td>
                          </Table.Tr>
                        );
                      })}
                    </Table.Tbody>
                  </ManifestTable>
                )}
                {manifest.map((resource, index) => {
                  const state = fileStates[index];
                  if (state?.status === "done") {
                    const result = state.verification;
                    if (result.status !== "mismatch") return null;
                    // A size disagreement is caught BEFORE hashing, so it has
                    // no `actualDigest` — titling it "Digest mismatch" and
                    // rendering "actual undefined" would hide the real failure.
                    const sizeFailure = result.actualDigest === undefined;
                    return (
                      <Alert
                        key={`mismatch:${index}`}
                        color="red"
                        title={
                          sizeFailure ? "Size mismatch" : "Digest mismatch"
                        }
                      >
                        <Stack gap={2}>
                          <MonoCaption>{resource.uri}</MonoCaption>
                          {sizeFailure ? (
                            <Text size="sm">{result.reason}</Text>
                          ) : (
                            <>
                              <MonoCaption>
                                expected {result.expectedDigest}
                              </MonoCaption>
                              <MonoCaption>
                                actual {result.actualDigest}
                              </MonoCaption>
                            </>
                          )}
                        </Stack>
                      </Alert>
                    );
                  }
                  if (state?.status === "error") {
                    return (
                      <Alert
                        key={`read:${index}`}
                        color="red"
                        title="Could not read file"
                      >
                        <Stack gap={2}>
                          <MonoCaption>{resource.uri}</MonoCaption>
                          <Text size="sm">{state.message}</Text>
                        </Stack>
                      </Alert>
                    );
                  }
                  return null;
                })}
              </Stack>

              {fetched?.message !== undefined && (
                <Alert color="red" title="skills/get failed">
                  {fetched.message}
                </Alert>
              )}
              {fetched?.entry !== undefined && (
                <Alert
                  data-testid="skills-get-result"
                  // Yellow, not red: `skills/get` is a fresh point-in-time
                  // snapshot, so a skill that genuinely changed since the
                  // listing legitimately differs. Worth showing, not an
                  // accusation.
                  color={fetched.matches ? "green" : "yellow"}
                  title={
                    fetched.matches
                      ? "skills/get matches skills/list"
                      : "skills/get returned a different snapshot"
                  }
                >
                  <Stack gap={2}>
                    <Text size="sm">
                      {fetched.matches
                        ? "The entry this server returns for this URI describes the same skill it listed (compared ignoring key and manifest order)."
                        : "The entry this server returns for this URI differs from the one it listed. `skills/get` is a fresh snapshot, so this is expected if the skill changed since the list was fetched — and a server inconsistency if it did not."}
                    </Text>
                    {!fetched.matches && (
                      <ContentViewer
                        block={{
                          type: "text",
                          text: JSON.stringify(fetched.entry, null, 2),
                        }}
                        mimeType="application/json"
                        copyable
                      />
                    )}
                  </Stack>
                </Alert>
              )}

              {previewError && (
                <Alert color="red" title="Could not read SKILL.md">
                  {previewError}
                </Alert>
              )}
              {preview && (
                <Stack gap="xs" data-testid="skill-md-preview">
                  <SectionHeading>SKILL.md</SectionHeading>
                  {/* `contents`, not a text `block`: a server may serve
                      SKILL.md as a base64 `blob`, and the block form would
                      substitute an empty string and paint a blank preview for
                      a file verification just read correctly. */}
                  <ContentViewer
                    contents={
                      typeof preview.text === "string"
                        ? {
                            uri: selected.uri,
                            text: preview.text,
                            mimeType: preview.mimeType ?? "text/markdown",
                          }
                        : {
                            uri: selected.uri,
                            blob: preview.blob ?? "",
                            mimeType: preview.mimeType ?? "text/markdown",
                          }
                    }
                    copyable
                  />
                </Stack>
              )}

              <Stack gap="xs">
                <SectionHeading>Frontmatter</SectionHeading>
                <ContentViewer
                  block={{
                    type: "text",
                    text: JSON.stringify(selected.frontmatter, null, 2),
                  }}
                  mimeType="application/json"
                  copyable
                />
              </Stack>
            </DetailStack>
          </DetailScroll>
        )}
      </DetailCard>
    </ScreenLayout>
  );
}
