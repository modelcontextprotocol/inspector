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

/** Per-file verification progress, keyed by the manifest entry's URI. */
type FileState =
  | { status: "pending" }
  | { status: "done"; verification: SkillVerification }
  | { status: "error"; message: string };

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
}: SkillsScreenProps) {
  const { selectedSkillUri, search } = ui;
  const [fileStates, setFileStates] = useState<Record<string, FileState>>({});
  const [preview, setPreview] = useState<SkillFileContents | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // Bumped every time the verdicts are invalidated. A read that was already in
  // flight captures the value it started under and discards its result when
  // this has moved on — otherwise a slow fetch for the previous selection (or
  // the previous manifest) lands afterwards and writes a verdict for content
  // nobody is looking at, or worse, one that was never checked.
  const epoch = useRef(0);

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

  // What every verdict on screen is a verdict *about*: the selected skill AND
  // the manifest it advertised. Keying invalidation on the URI alone would
  // leave a green `verified` badge attached to a digest the Refresh replaced,
  // so the UI would vouch for content it has never checked. A primitive string
  // rather than the manifest object, because `useValueChange` compares with
  // `Object.is` and a fresh array every render would loop.
  const manifestKey = useMemo(
    () =>
      [
        selectedSkillUri ?? "",
        selected?.resources === DYNAMIC_RESOURCES ? "dynamic" : "",
        ...manifest.map((r) => `${r.uri}|${r.digest ?? ""}|${r.size ?? ""}`),
      ].join("\n"),
    [manifest, selected, selectedSkillUri],
  );

  // Adjusted DURING RENDER via `useValueChange` rather than in an effect, so a
  // new selection (or a refreshed manifest) never paints a frame carrying the
  // previous one's verification results. The epoch bump is a ref write, which
  // is why it is done in the callback alongside the state resets rather than
  // during the render body itself.
  useValueChange(manifestKey, () => {
    epoch.current += 1;
    setFileStates({});
    setPreview(null);
    setPreviewError(null);
  });

  const verifyFile = useCallback(
    async (resource: SkillResource) => {
      const started = epoch.current;
      setFileStates((prev) => ({
        ...prev,
        [resource.uri]: { status: "pending" },
      }));
      try {
        const contents = await onReadSkillFile(resource.uri);
        const verification = await verifySkillResource(
          resource,
          skillFileBytes(contents),
        );
        if (epoch.current !== started) return;
        setFileStates((prev) => ({
          ...prev,
          [resource.uri]: { status: "done", verification },
        }));
      } catch (err) {
        if (epoch.current !== started) return;
        setFileStates((prev) => ({
          ...prev,
          [resource.uri]: {
            status: "error",
            message: err instanceof Error ? err.message : String(err),
          },
        }));
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
    const worker = async (): Promise<void> => {
      for (let i = next++; i < manifest.length; i = next++) {
        await verifyFile(manifest[i]);
      }
    };
    const workers = Math.min(VERIFY_CONCURRENCY, manifest.length);
    void Promise.all(Array.from({ length: workers }, () => worker()));
  }, [manifest, verifyFile]);

  const showSkillMd = useCallback(() => {
    if (!selected) return;
    const started = epoch.current;
    // A click handler cannot await, and this chain terminates in its own
    // `catch` that surfaces the message in the preview slot. Both arms are
    // epoch-guarded: a read that resolves after the selection moved on would
    // otherwise show one skill's SKILL.md under another's heading.
    void onReadSkillFile(selected.uri)
      .then((contents) => {
        if (epoch.current !== started) return;
        setPreview(contents);
        setPreviewError(null);
      })
      .catch((err: unknown) => {
        if (epoch.current !== started) return;
        setPreview(null);
        setPreviewError(err instanceof Error ? err.message : String(err));
      });
  }, [onReadSkillFile, selected]);

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
                    {issues.map((issue) => (
                      <Alert
                        key={`${issue.code}:${issue.resourceUri ?? ""}`}
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
                <ControlsRow>
                  <InlineRow>
                    <SectionHeading>Resources</SectionHeading>
                    <CountBadge>
                      {manifest.length} file(s), {totalSkillBytes(manifest)}{" "}
                      bytes
                    </CountBadge>
                  </InlineRow>
                  <InlineRow>
                    <VerifyButton onClick={showSkillMd}>
                      View SKILL.md
                    </VerifyButton>
                    <VerifyButton
                      onClick={verifyAll}
                      disabled={manifest.length === 0}
                    >
                      Verify all
                    </VerifyButton>
                  </InlineRow>
                </ControlsRow>
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
                      {manifest.map((resource) => {
                        const state = fileStates[resource.uri];
                        const color =
                          state?.status === "done"
                            ? verificationColor(state.verification.status)
                            : state?.status === "error"
                              ? "red"
                              : "gray";
                        return (
                          <Table.Tr key={resource.uri}>
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
                                  onClick={() => void verifyFile(resource)}
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
                {manifest.map((resource) => {
                  const state = fileStates[resource.uri];
                  if (state?.status === "done") {
                    const { verification } = state;
                    if (verification.status === "mismatch") {
                      return (
                        <Alert
                          key={`mismatch:${resource.uri}`}
                          color="red"
                          title="Digest mismatch"
                        >
                          <Stack gap={2}>
                            <MonoCaption>{resource.uri}</MonoCaption>
                            <MonoCaption>
                              expected {verification.expectedDigest}
                            </MonoCaption>
                            <MonoCaption>
                              actual {verification.actualDigest}
                            </MonoCaption>
                          </Stack>
                        </Alert>
                      );
                    }
                    return null;
                  }
                  if (state?.status === "error") {
                    return (
                      <Alert
                        key={`read:${resource.uri}`}
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

              {previewError && (
                <Alert color="red" title="Could not read SKILL.md">
                  {previewError}
                </Alert>
              )}
              {preview && (
                <Stack gap="xs" data-testid="skill-md-preview">
                  <SectionHeading>SKILL.md</SectionHeading>
                  <ContentViewer
                    block={{ type: "text", text: preview.text ?? "" }}
                    mimeType={preview.mimeType ?? "text/markdown"}
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
