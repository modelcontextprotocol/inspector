import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Card,
  Code,
  Flex,
  Group,
  NavLink,
  Paper,
  Stack,
  Table,
  Text,
  TextInput,
  VisuallyHidden,
} from "@mantine/core";
import { MdSearch, MdVerifiedUser } from "react-icons/md";
import { RiArrowRightSLine } from "react-icons/ri";
import type {
  DirectoryReadResult,
  SkillEntry,
  SkillResource,
} from "@inspector/core/mcp/skillsSchemas.js";
import {
  DIRECTORY_MIME_TYPE,
  DYNAMIC_RESOURCES,
} from "@inspector/core/mcp/skillsSchemas.js";
import {
  checkSkillConformance,
  checkSkillFrontmatterMatch,
  checkSkillNameCollisions,
  bytesToText,
  skillDisplayName,
  skillEntryKey,
  skillFileBytes,
  skillEntriesMatch,
  normalizeSkillUri,
  skillUriIdentity,
  SKILL_FILE_SUFFIX,
  totalSkillBytes,
  verifySkillResource,
  type SkillFileContents,
  type SkillIssue,
  type SkillVerification,
} from "@inspector/core/mcp/skills.js";
import { CodeHighlight } from "../../elements/CodeHighlight/CodeHighlight";
import { ContentViewer } from "../../elements/ContentViewer/ContentViewer";
import { ListToggle } from "../../elements/ListToggle/ListToggle";
import { useValueChange } from "../../../hooks/useValueChange";
import { splitSkillFile } from "@inspector/core/mcp/skillFile.js";
import {
  inferMimeFromUri,
  isGenericMime,
  isMarkdownMime,
} from "../../../utils/inferMimeFromUri";
import { tryDecodeBase64ToUtf8 } from "../../elements/ContentViewer/contentViewerUtils";

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
  /**
   * The text of the skill's own `SKILL.md` **as the verification read it**.
   *
   * Held so the frontmatter comparison and the digest describe the *same*
   * fetch. They were derived from two separate `resources/read` calls — the
   * on-selection preview and the Verify click — so a resource that changed
   * between them could pair a verified digest with a frontmatter verdict for
   * different bytes (Copilot). Set only when the verified row is the entry's
   * own file; the preview remains the fallback until then, since a reader who
   * has not clicked Verify should still get the check.
   */
  entryText?: string;
}

/**
 * The resource on display in the viewer, plus the manifest it belongs to
 * (`null` as above) and the request that produced it. The manifest key cannot
 * order two reads issued for the SAME manifest, so without `attempt` a second
 * click whose older read finishes last would replace the newer contents.
 *
 * `uri` is claimed at request time rather than on settle, so the heading names
 * the file being fetched while it is still in flight — a viewer that keeps
 * announcing the previous file until the bytes land is reporting the wrong
 * thing for exactly as long as the read takes.
 */
interface PreviewState {
  key: string | null;
  attempt?: number;
  /** The resource this slot is showing (or fetching). */
  uri?: string;
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
  /** Conformance findings for the FETCHED entry, in its own right. */
  issues?: SkillIssue[];
  /** True when the fetched entry describes the same skill as the listed one. */
  matches?: boolean;
  /** True when the fetched entry is for a different URI than was asked for. */
  wrongUri?: boolean;
  message?: string;
}

/**
 * One child of a directory resource, as `resources/directory/read` returned it.
 * Structurally the base protocol's `Resource`; only the three members this
 * section renders are named.
 */
interface DirectoryChild {
  uri: string;
  name: string;
  mimeType?: string;
}

/**
 * The directory browser's state: which directory is on screen, the children
 * gathered so far, and the cursor for the next page.
 *
 * Pages **accumulate** rather than replacing, unlike a paged list elsewhere in
 * the app, because a directory listing is one thing split across responses — a
 * reader descending a tree wants the directory's contents, not page 2 of them.
 * `key` invalidates it exactly as it does every other async slot here.
 */
interface DirectoryState {
  key: string | null;
  attempt?: number;
  /** The directory being shown (or read). */
  uri?: string;
  children?: DirectoryChild[];
  /** Cursor for the page after `children`, when the server sent one. */
  nextCursor?: string;
  loading?: boolean;
  message?: string;
}

export interface SkillsScreenProps {
  /**
   * Identity of the connected session. Part of the invalidation key below, so
   * a verification still in flight when the user switches servers cannot land
   * afterwards and report a verdict for an identical-looking entry on the new
   * one — this screen stays mounted across a disconnect, so content alone does
   * not distinguish the two.
   */
  sessionKey: string;
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
   * Re-fetch the selected entry through `skills/get` (SEP-2640) — the
   * extension's second required method, which nothing else in the app calls.
   *
   * It is a **fresh point-in-time snapshot**, so a conforming result may
   * legitimately differ from an older listing, and the screen presents a
   * difference as an updated snapshot rather than a fault. What it does treat
   * as a fault is the fetched entry being non-conforming in its own right, or
   * answering for a different URI than the one requested — neither of which a
   * fresh read excuses.
   */
  onGetSkill: (uri: string) => Promise<SkillEntry>;
  /**
   * One page of `resources/directory/read` (SEP-2640), or **`undefined` when
   * the server did not declare `directoryRead`** — which is how the Directory
   * section is gated.
   *
   * Gated by the prop's presence rather than by a boolean beside it, so the
   * section cannot be rendered without a way to populate it: the SEP makes
   * calling this method against a server that has not declared the sub-flag a
   * MUST NOT, and an absent callback is that rule expressed in the type.
   */
  onReadResourceDirectory?: (
    uri: string,
    cursor?: string,
  ) => Promise<DirectoryReadResult>;
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

// The detail pane is a flex column that does NOT scroll as a whole (#2263).
// The disclosure accordion inside it owns the height: each open section scrolls
// within its own share, so nothing scrolls until a section's content overflows
// the space it was given.
const DetailColumn = Stack.withProps({
  gap: "md",
  flex: 1,
  mih: 0,
});

// Every constant below carries LAYOUT only; the typographic treatment each one
// wants (weight, size, colour, monospace face) is a `ThemeText` variant, since
// flat CSS properties belong in the theme rather than at the call site.
const EmptyState = Text.withProps({
  variant: "emptyState",
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

// Bare, like the Refresh in `ListChangedIndicator` that Tools, Resources and
// Prompts use — this screen was the only one with a glyph on it.
const RefreshButton = Button.withProps({
  variant: "subtle",
  size: "compact-xs",
});

// Both header actions take the Refresh button's style from
// `ListChangedIndicator` — `sm` + `subtle` — so the pane's controls read as the
// same kind of control the rest of the app uses, and sit level with the
// `ListToggle` beside them.
//
// The shield stays on the controls that actually check integrity — "Verify all"
// and the per-row "Verify". `skills/get` re-fetches an entry and compares it
// against the listing; that is a consistency check, not a digest verification,
// so the icon would overstate what that button does.
const VerifyButton = Button.withProps({
  size: "sm",
  variant: "subtle",
  leftSection: <MdVerifiedUser aria-hidden size={14} />,
});

const FetchButton = Button.withProps({
  size: "sm",
  variant: "subtle",
});

// A `Text` renders a `<p>`, so a section heading must never *wrap* the count
// badge beside it — a `<div>` inside a `<p>` is invalid HTML that React reports
// as a hydration error and the Storybook run fails on. Heading and badge sit
// side by side in an `InlineRow` instead.
const SectionHeading = Text.withProps({
  variant: "sectionHeading",
});

const MonoCaption = Text.withProps({
  variant: "monoCaption",
});

// The selected skill's URI, clamped for the same reason as its description
// below — it is the OTHER server-controlled string in the pane's fixed header,
// and a URI with many breakable path segments wraps just as freely as prose.
// A skill URI is usually one line, so two is generous; the full value stays on
// the `title` the call site passes.
const SkillUriCaption = Text.withProps({
  variant: "monoCaption",
  lineClamp: 2,
});

// The skill's description, clamped.
//
// It sits in the pane's FIXED header, beside an accordion whose basis is zero,
// so its height is subtracted from everything below it. SEP-2640 permits 1,024
// characters and a non-conforming server can send more — in a narrow or short
// pane that wraps to enough lines to crowd the sections out entirely, which is
// the same "server-controlled content sizes the layout" trap `viewerFlex`
// documents. Three lines is enough to read a real description; the full text
// stays available through the native `title` tooltip the call site passes.
const SkillDescription = Text.withProps({
  variant: "skillDescription",
  lineClamp: 3,
});

// The Skill Resource control's row. `nowrap` is load-bearing: flexbox wraps
// BEFORE it shrinks, so in a wrapping row a long file name pushes itself onto a
// second line and grows the pinned control no matter how the caption is
// clamped. With nowrap the caption's `miw: 0` can take effect and it ellipsizes
// instead.
const ResourceHeaderRow = Group.withProps({
  justify: "space-between",
  wrap: "nowrap",
  gap: "sm",
  w: "100%",
});

// The displayed file's name, in the Skill Resource section's CONTROL — which is
// pinned and therefore does not scroll, so a resource URI ending in a very long
// breakable segment would grow the header itself. One line, with the full name
// on the `title` the call site passes.
const ResourceNameCaption = Text.withProps({
  variant: "monoCaption",
  // `truncate` alone is not enough: the caption sits in a wrapping header row,
  // so a long name whose MIN-CONTENT width exceeds the space simply pushes
  // itself onto a second line and grows the control anyway. `miw: 0` lets flex
  // shrink it below that width, which is what actually engages the ellipsis.
  truncate: "end",
  // `miw: 0` alone was not enough — Mantine's Accordion label wrapper does not
  // let the row shrink, so the caption kept its content width and grew the
  // control anyway. A hard cap gives the ellipsis a definite width to work
  // against, which is what actually bounds the pinned header.
  miw: 0,
  maw: "50%",
});

/** A read that failed, in the Directory section. */
const ReadFailureAlert = Alert.withProps({
  color: "red",
  variant: "light",
  title: "Read failed",
});

/**
 * The directory-vs-manifest divergence banner. Yellow: the server is not
 * necessarily wrong — its listing may simply be newer than the held entry.
 */
const UnlistedChildrenAlert = Alert.withProps({
  color: "yellow",
  variant: "light",
  title: "This directory lists files the entry does not",
});

/** The em dash standing in for a verdict that does not apply to a row. */
const NoVerdictText = Text.withProps({ size: "xs", c: "dimmed" });

const IssueStack = Stack.withProps({
  gap: "xs",
});

// The Conformance panel stacks banners from three different sources — the
// static findings, the per-file verification verdicts, and the `skills/get`
// comparison — and they are only legible as separate statements if they are
// spaced apart. `sm` is the gap the monitoring sidebar's list uses.
const ConformanceStack = Stack.withProps({
  gap: "sm",
});

// The frontmatter JSON has no surface of its own — the editor renders straight
// onto the panel background, so it reads as loose text rather than as a block.
// A bordered Paper gives it the same framed treatment the manifest table gets
// from `withTableBorder`.
const FramedContent = Paper.withProps({
  withBorder: true,
  radius: "sm",
  p: "xs",
});

const ManifestTable = Table.withProps({
  variant: "manifest",
  striped: true,
  withTableBorder: true,
  // Rows react to the pointer because each one is now clickable — its URI cell
  // swaps the file in the viewer below (#2263).
  highlightOnHover: true,
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

// The per-row integrity check. Carries the same shield as "Verify all" — both
// verify digests, and giving only one of them the icon made the icon look
// decorative rather than meaningful.
const RowVerifyButton = Button.withProps({
  variant: "subtle",
  size: "compact-xs",
  leftSection: <MdVerifiedUser aria-hidden size={12} />,
});

// The action column: sized to its button and right-aligned, so the buttons form
// one straight edge instead of tracking the verdict badge's width.
const ActionCell = Table.Td.withProps({
  w: 1,
  ta: "right",
});

// The URI cell is a control, not a label: clicking it puts that file in the
// viewer. Full width of its column with the URI left-aligned, so the column
// still reads as a column of URIs rather than a column of centred buttons —
// the whole cell is the target, which is what makes a long list of files
// comfortable to click through.
const ResourceUriButton = Button.withProps({
  size: "compact-xs",
  fullWidth: true,
  // Mantine's own alignment prop, not a style override: it drives the button's
  // `inner` justify-content, which is what keeps a long URI reading as the
  // start of a line rather than a centred label.
  justify: "flex-start",
});

const SkillTitle = Text.withProps({
  variant: "skillTitle",
  // A Mantine behaviour prop, not a style: it swaps the element for a
  // single-line truncating one rather than setting a CSS property.
  truncate: true,
});

/**
 * Per-section flex for the metadata sections: content height, but **able to
 * shrink to the `mih` floor**.
 *
 * This setting has been wrong in both directions, so both are recorded.
 *
 * Weighting the shrink by item count, as `ResourceControls` does (#1462), let a
 * section be squeezed far below its content and slice it mid-line — a `Digest
 * mismatch` alert cut in half by the header beneath it. The panel really was
 * scrollable, but a macOS overlay scrollbar is invisible until hover, so it
 * read as broken.
 *
 * Refusing to shrink at all fixed that and reintroduced the original bug at
 * scale: a *conforming* manifest may declare 512 rows, and a section holding
 * its full intrinsic height pushes the file viewer off the bottom, so reaching
 * the file means scrolling past the manifest — precisely the "the file is
 * behind the manifest" problem this screen was refactored to end.
 *
 * `0 1 auto` with the `OPEN_SECTION_MIN_HEIGHT` floor is the setting that
 * satisfies both: a section gives up space until it hits the floor, its panel
 * scrolls internally from there, and the viewer keeps the remainder. The floor
 * is what stops the shrink becoming a crush; nothing above it is sliced,
 * because a panel at the floor scrolls rather than clips.
 */
const SECTION_FLEX = "0 1 auto";

/** Every section this screen can render, in display order. */
const ALL_SECTIONS = [
  "conformance",
  "resources",
  "directory",
  "frontmatter",
  "resource",
];

/**
 * The sections that open by default — everything except Directory.
 *
 * Directory is the one section whose content requires a round trip the user has
 * not made yet, so open it holds a button and an empty frame: it advertises
 * content that is not there, while taking height from the sections that do have
 * some. With five open sections in a short pane each is squeezed to its floor
 * and scrolls internally, which is the documented fallback but a poor first
 * impression — and the one it costs most is the file viewer, the section
 * `viewerFlex` exists to give the remainder to.
 *
 * The same argument as Conformance's auto-collapse, one step earlier: that one
 * closes a section whose header already carries the whole answer, this one
 * closes a section that has no answer yet. Both are defaults; neither prevents
 * opening it, and `openSections` outlives a selection, so a user who opens
 * Directory keeps it open across skills.
 */
const DEFAULT_OPEN_SECTIONS = ALL_SECTIONS.filter(
  (section) => section !== "directory",
);

/**
 * The open set for the FIRST render.
 *
 * `useValueChange` deliberately does not fire on the first render, so the
 * clean-entry auto-collapse it drives cannot cover a screen that mounts with a
 * skill already selected — a restored `SkillsUiState` does exactly that. This
 * applies the same rule up front, so the behaviour does not depend on a later
 * selection change to start working.
 */
function initialOpenSections(
  skills: SkillEntry[],
  selectedSkillUri: string | undefined,
): string[] {
  if (selectedSkillUri === undefined) return DEFAULT_OPEN_SECTIONS;
  const wanted = skillUriIdentity(selectedSkillUri);
  const entry = skills.find((skill) => skillUriIdentity(skill.uri) === wanted);
  if (entry === undefined) return DEFAULT_OPEN_SECTIONS;
  // Counts the collision finding too, or an entry whose ONLY finding is a name
  // collision would mount with Conformance collapsed while its header badge
  // said there was something to see.
  const hasFindings =
    checkSkillConformance(entry).length > 0 ||
    checkSkillNameCollisions(skills).has(wanted);
  return hasFindings
    ? DEFAULT_OPEN_SECTIONS
    : DEFAULT_OPEN_SECTIONS.filter((section) => section !== "conformance");
}

/**
 * The file viewer's flex, which is deliberately NOT `sectionFlex`.
 *
 * The basis is **`0`, not `auto`**, and that is the whole point. `auto` makes a
 * flex item's basis its content height, and this panel's content is a rendered
 * document — 1,795px for the `data-analysis` fixture. That basis joins the sum
 * the container distributes, so the column becomes wildly over-constrained and
 * the shrink factors crush the *other* sections: measured on the fixture,
 * Conformance collapsed to a 2px panel and Resources to zero height, their
 * contents spilling over the headers below. Collapsing this section removed the
 * giant basis and everything laid out correctly, which is exactly why the mess
 * appeared on collapse-then-reopen.
 *
 * With a basis of `0` the viewer contributes nothing to that sum and simply
 * takes the space the other sections leave, which is what "fills the remainder"
 * has to mean here.
 */
function viewerFlex(open: boolean): string {
  return open ? "1 1 0" : "0 0 auto";
}

/**
 * A floor for an open section, so shrinking can never take one below its own
 * header.
 *
 * The `disclosure` CSS sets `min-height: 0` on an active item — necessary for
 * its panel to scroll rather than overflow, but it also permits the collapse to
 * nothing described above. A Mantine `mih` prop is an inline style and so wins
 * over that rule, bounding the shrink without touching the shared stylesheet.
 * The value leaves the control plus a usable sliver of panel; a section pushed
 * to it scrolls its own content.
 */
const OPEN_SECTION_MIN_HEIGHT = 96;

/**
 * Colour for the Conformance count badge, which summarises a whole finding list
 * rather than one finding.
 *
 * Green means the entry is clean, so it must not be shown for an entry that has
 * warnings: a `dynamic-resources` or `size-limit-exceeded` finding is something
 * the reader is meant to notice, and a green badge is read as "nothing to see"
 * — the badge would be actively hiding the only signal the section carries.
 * Yellow matches the warnings' own alerts (`issueColor`).
 */
function summaryColor(errorCount: number, warningCount: number): string {
  if (errorCount > 0) return "red";
  return warningCount > 0 ? "yellow" : "green";
}

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

/**
 * The file name a resource URI ends in, for the viewer heading.
 *
 * Deliberately string surgery rather than `new URL(...)`: a skill URI's scheme
 * is not constrained by SEP-2640 (`skill://` is only a SHOULD), so a
 * domain-native scheme this app has never seen can reach here, and a heading
 * that throws would break the one region of the pane that has to keep working
 * for a non-conforming server. Falls back to the whole URI when there is no
 * trailing segment to take.
 */
function resourceFileName(uri: string): string {
  const withoutQuery = uri.split(/[?#]/)[0];
  const last = withoutQuery.slice(withoutQuery.lastIndexOf("/") + 1);
  return last || uri;
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
 * verification verdict.
 *
 * **Reading is not verification, and the two have different triggers** (#2263).
 * The skill's own `SKILL.md` is read as soon as it is selected, so the file is
 * simply on screen; SEP-2640 is explicit that a `resources/read` of a skill
 * file is *not* a load and confers no standing, so that claims nothing on the
 * user's behalf. Digest **verification** remains strictly on demand — it is
 * what the buttons are for, and nothing is hashed until asked.
 */
export function SkillsScreen({
  sessionKey,
  skills,
  pageCount,
  loadError,
  ui,
  onUiChange,
  onRefreshList,
  onReadSkillFile,
  onGetSkill,
  onReadResourceDirectory,
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
  const [directory, setDirectory] = useState<DirectoryState>({ key: null });
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
  // Which sections are open. A view preference, so it is deliberately NOT reset
  // by the manifest-change invalidation below — a user who collapsed a section
  // wants it collapsed on the next skill too.
  //
  // Everything starts open. The one thing that closes on its own is Conformance
  // for an entry with no findings, and that is because its header badge already
  // carries the whole answer; nothing else here can be summarised by its header,
  // so opening collapsed would just hide content behind a click the user has no
  // reason to expect.
  //
  // The initialiser has to make that judgement too, not just the
  // `useValueChange` below: that hook deliberately does not fire on the first
  // render, so a screen MOUNTING on an already-selected clean skill — a
  // restored `SkillsUiState`, say — would otherwise show Conformance expanded
  // and only start honouring the rule after some later selection change.
  const [openSections, setOpenSections] = useState<string[]>(() =>
    initialOpenSections(skills, ui.selectedSkillUri),
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

  // Matched by IDENTITY, like every other URI comparison here: a refresh that
  // canonicalizes `skill://demo/%53KILL.md` to `skill://demo/SKILL.md` names
  // the same skill, and the detail pane must not empty out because the server
  // changed its spelling.
  const selected = useMemo(() => {
    if (selectedSkillUri === undefined) return undefined;
    const wanted = skillUriIdentity(selectedSkillUri);
    return skills.find((skill) => skillUriIdentity(skill.uri) === wanted);
  }, [skills, selectedSkillUri]);

  /**
   * Name collisions across the whole listing, keyed by URI identity.
   *
   * Computed over `skills` rather than the filtered view: a collision is a fact
   * about the catalog the server served, and hiding it because the sidebar
   * search happens to exclude the other half would make the finding depend on
   * what the reader typed.
   */
  const collisions = useMemo(() => checkSkillNameCollisions(skills), [skills]);

  const collision = selected
    ? collisions.get(skillUriIdentity(selected.uri))
    : undefined;

  const issues = useMemo(() => {
    if (!selected) return [];
    // Merged into the entry's own findings so it carries through the header
    // badge and the sidebar exactly as every other finding does — a reader
    // asking "does this skill conform" must not have to know that one class of
    // finding is counted somewhere else. It is *rendered* as a banner above
    // rather than as a list item, and filtered out of the list accordingly.
    const found = collisions.get(skillUriIdentity(selected.uri));
    return [...checkSkillConformance(selected), ...(found ? [found] : [])];
  }, [collisions, selected]);

  // A `resources: "dynamic"` skill advertises no manifest at all, so it has no
  // Resources section to show — the fact is a conformance statement, and it is
  // made once, there.
  const isDynamic = selected?.resources === DYNAMIC_RESOURCES;

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
    () =>
      // `skillEntryKey`, not `JSON.stringify`: `selected` carries unbounded
      // server-controlled frontmatter, and this runs during render — so a
      // deeply nested entry threw `RangeError` before the screen could show
      // the `frontmatter-unparsable` finding that describes it (Copilot). Same
      // helper, and the same guard, the TUI uses.
      `${sessionKey}\n${selected ? skillEntryKey(selected) : (selectedSkillUri ?? "")}`,
    [selected, selectedSkillUri, sessionKey],
  );

  // Adjusted DURING RENDER via `useValueChange` rather than in an effect, so a
  // new selection (or a refreshed manifest) never paints a frame carrying the
  // previous one's verification results. `setState` calls only — the hook
  // replays this callback whenever React replays the render.
  useValueChange(manifestKey, (next) => {
    setVerification({ key: next, files: {} });
    setPreviewState({ key: next });
    setFetchedEntry({ key: next });
    // A directory listing is a live observation of a path under the *selected*
    // skill, so it is invalidated with everything else — carrying one across a
    // selection change would show the previous skill's tree under the new
    // skill's name.
    setDirectory({ key: next });
    // Conformance tracks whether it has anything to say: an entry with no
    // errors and no warnings opens collapsed, because "0 error(s), 0
    // warning(s)" on the header already carries the whole message and an
    // expanded "Conforms" panel is just space the file viewer could use. An
    // entry WITH findings opens expanded, so switching from a clean skill to a
    // broken one does not hide the findings behind a click.
    //
    // Adjusted here, during render, rather than in an effect — the same reason
    // the three invalidations above are: an effect would paint one frame with
    // the previous skill's answer.
    setOpenSections((prev) => {
      const hasFindings = issues.length > 0;
      const isOpen = prev.includes("conformance");
      if (hasFindings === isOpen) return prev;
      return hasFindings
        ? [...prev, "conformance"]
        : prev.filter((section) => section !== "conformance");
    });
  });

  const fileStates = verification.key === manifestKey ? verification.files : {};
  const entrySourceText =
    verification.key === manifestKey ? verification.entryText : undefined;

  /**
   * Verify one manifest ROW. Keyed by row index, not by URI: the checker
   * deliberately tolerates a duplicated URI so it can report
   * `duplicate-resource`, and two rows sharing a key would share one verdict —
   * verifying either would update both, and "Verify all" would race two
   * different digest/size declarations into the same slot.
   */
  /**
   * Reveal the Conformance section, which auto-collapses for an entry with no
   * static findings — `tampered-notes` is exactly that: structurally clean,
   * bytes wrong — so a verdict would otherwise land where nobody can see it.
   *
   * Called from the USER gestures that produce a verdict, never from the async
   * work they start: an open-state update is not keyed to a manifest, so
   * calling it from a continuation would let stale work mutate the current
   * pane.
   */
  const openConformance = useCallback(() => {
    setOpenSections((prev) =>
      prev.includes("conformance") ? prev : [...prev, "conformance"],
    );
  }, []);

  /**
   * Whether a manifest row IS the skill's own `SKILL.md`.
   *
   * By normalized identity, like every other URI comparison here — a manifest
   * that spells its self-entry equivalently still names the same file.
   */
  const isSelfResource = useCallback(
    (resource: SkillResource) =>
      selected !== undefined &&
      skillUriIdentity(resource.uri) === skillUriIdentity(selected.uri),
    [selected],
  );

  const verifyRow = useCallback(
    async (
      index: number,
      resource: SkillResource,
      key: string,
      isSelfRow = false,
    ) => {
      // NOTE: opening the Conformance section deliberately does NOT happen
      // here. `verifyRow` is called once per row by every "Verify all" worker
      // as it advances, so a batch begun on one skill keeps calling it after
      // the user has switched to another. The keyed writes above discard those
      // continuations, but an open-state update is not keyed to a manifest and
      // would have reopened Conformance on whatever skill is now selected.
      // The section is opened at the two USER entry points instead — the row
      // button and "Verify all" — where the gesture and the pane agree.
      //
      // Claimed synchronously, so two verifications of this row are ordered
      // before either read starts.
      const attempt = (nextAttempt.current += 1);
      const write = (state: FileState, entryText?: string) =>
        setVerification((prev) => {
          // `null` is the un-adopted initial manifest; any other mismatch is a
          // continuation from a manifest that has since been invalidated.
          if (prev.key !== null && prev.key !== key) return prev;
          const files = prev.key === key ? prev.files : {};
          // A newer attempt for this row already wrote — an older read
          // finishing last must not overwrite it.
          const held = files[index];
          if (held !== undefined && held.attempt > attempt) return prev;
          return {
            key,
            files: { ...files, [index]: state },
            // Carried through explicitly: this returns a FRESH state object, so
            // anything not named here is dropped — which silently discarded the
            // verified `SKILL.md` text the frontmatter check depends on.
            ...(entryText !== undefined
              ? { entryText }
              : prev.key === key && prev.entryText !== undefined
                ? { entryText: prev.entryText }
                : {}),
          };
        });
      write({ attempt, status: "pending" });
      try {
        const contents = await onReadSkillFile(resource.uri);
        const bytes = skillFileBytes(contents);
        const result = await verifySkillResource(resource, bytes);
        // The entry's own file is captured in the SAME write as its verdict, so
        // the frontmatter check reads the very bytes that were just hashed —
        // see `VerificationState.entryText`.
        write(
          { attempt, status: "done", verification: result },
          isSelfRow ? bytesToText(bytes) : undefined,
        );
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
    // One of the two user entry points that opens Conformance — the verdicts
    // render there, and it may be collapsed for a structurally clean entry.
    // Done here rather than in `verifyRow` so a batch that outlives its own
    // selection cannot reopen the section on a different skill.
    openConformance();
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
        await verifyRow(i, manifest[i], key, isSelfResource(manifest[i]));
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
  }, [manifest, manifestKey, openConformance, verifyRow, isSelfResource]);

  /**
   * Put one of the skill's files in the viewer. Driven both by the effect that
   * loads `SKILL.md` on selection and by the manifest's URI buttons.
   *
   * The manifest `key` is a parameter rather than a closure read, so the
   * selection effect below can pass the manifest it is loading *for* instead of
   * whichever one happened to be current when this callback was created.
   */
  const showResource = useCallback(
    (uri: string, key: string, isEntryUri = false) => {
      const attempt = (nextAttempt.current += 1);
      // A click handler cannot await, and this chain terminates in its own
      // `catch` that surfaces the message in the viewer. Both arms go through
      // `writePreview`, which drops a result whose manifest has been
      // invalidated OR whose request has been superseded.
      const writePreview = (next: Omit<PreviewState, "key" | "attempt">) =>
        setPreviewState((prev) =>
          isStale(prev, key, attempt) ? prev : { key, attempt, ...next },
        );
      // Claimed BEFORE the request goes out, the way `verifyRow` claims its
      // row. Recording the attempt only on settle leaves a window where an
      // older request that happens to resolve first is still considered
      // current, and publishes its contents while a newer one is in flight.
      // The `uri` rides along on every write so the heading names the file
      // being fetched while the read is still running, rather than continuing
      // to announce the previous one for as long as the read takes.
      writePreview({ uri });
      void onReadSkillFile(uri)
        .then((contents) => {
          writePreview({ uri, contents });
          // A successful read of the skill's OWN file is recorded in the
          // skill-scoped slot, so the frontmatter verdict it produces outlives
          // the reader opening a supporting file — see
          // `VerificationState.entryText`. Only on success, and only for that
          // file: a failed or unrelated read must not overwrite an answer.
          if (isEntryUri) {
            let text: string | undefined;
            try {
              text = bytesToText(skillFileBytes(contents));
            } catch {
              return; // neither text nor blob; the viewer reports it
            }
            setVerification((prev) =>
              prev.key !== null && prev.key !== key
                ? prev
                : {
                    ...prev,
                    key,
                    files: prev.key === key ? prev.files : {},
                    entryText: text,
                  },
            );
          }
        })
        .catch((err: unknown) => {
          writePreview({
            uri,
            message: err instanceof Error ? err.message : String(err),
          });
        });
    },
    [onReadSkillFile],
  );

  // The skill's own SKILL.md is what the viewer opens on, so it is read when
  // the selection changes rather than behind a button (#2263).
  //
  // An EFFECT, deliberately, and it is the legitimate kind: `useValueChange`
  // above already dropped the previous skill's results during render, so there
  // is no stale frame to fix here — this is the separate act of talking to an
  // external system, which is the one thing an effect is still for. It could
  // not live in the `useValueChange` callback anyway; that runs during render
  // and must stay `setState`-only.
  //
  // SEP-2640 is explicit that a `resources/read` of a SKILL.md is NOT a load
  // and confers no standing, so reading it on selection claims nothing on the
  // user's behalf.
  // A primitive, so the effect below depends on the URI rather than on the
  // entry object: `selected` is re-derived whenever `skills` is replaced, and
  // depending on it would re-read the file every time the list was refetched
  // with identical content.
  const selectedUri = selected?.uri;

  // Which manifest the automatic read has already been issued for.
  //
  // A ref rather than state, because this must not itself cause a render. Its
  // scope is ONE MOUNT, and that is the whole of what it can promise: React
  // StrictMode deliberately replays effects (`main.tsx` renders under it), so
  // without a guard a single selection fires two identical `resources/read`
  // calls. In an app whose whole purpose is showing people the protocol
  // traffic, an extra request in the Protocol panel that the user's own client
  // would never send is worse than a wasted round trip — it is the Inspector
  // misreporting the conversation.
  //
  // It deliberately does NOT suppress the read after a `ScreenStage` remount,
  // and could not: a remount mints a fresh ref. That is the correct behavior
  // rather than a gap, because `previewState` is local state too and dies with
  // the same unmount — so on return the viewer is empty and the read is what
  // refills it. Suppressing it would need the preview bytes hoisted above
  // `ScreenStage`, which would trade a legitimate request for a cache.
  const autoReadKey = useRef<string | null>(null);

  useEffect(() => {
    if (selectedUri === undefined) {
      // The entry left `skills` — a refresh in flight, or a disconnect.
      // `useValueChange` has already emptied the viewer, so if the IDENTICAL
      // entry reappears its `manifestKey` matches what this ref still holds
      // and the read would be skipped, stranding the viewer permanently
      // blank. Clearing the guard is what lets that reappearance re-read.
      autoReadKey.current = null;
      return;
    }
    if (autoReadKey.current === manifestKey) return;
    autoReadKey.current = manifestKey;
    showResource(selectedUri, manifestKey, true);
  }, [manifestKey, selectedUri, showResource]);

  /**
   * The skill's root directory: its entry URI with `/SKILL.md` removed.
   *
   * Computed from the NORMALIZED URI, like every containment decision in
   * `core/mcp/skills.ts`, so a `..` segment cannot produce a root the resolved
   * path does not carry. `undefined` for a malformed entry URI — there is no
   * root to browse, and `malformed-uri` already reports that in Conformance.
   */
  const skillRoot = useMemo(() => {
    if (!selected) return undefined;
    // `normalizeSkillUri`, NOT `skillUriIdentity`: the latter falls back to the
    // raw string when parsing fails, so `not a uri/SKILL.md` yielded the "root"
    // `not a uri` and enabled the Directory section — letting the UI send a
    // directory request derived from a URI the conformance checks had already
    // rejected as malformed (Copilot). Identity is the right tool for
    // COMPARING two spellings; it is the wrong one for deciding that a URI is
    // well-formed enough to build a request from.
    const normalized = normalizeSkillUri(selected.uri);
    return normalized !== undefined && normalized.endsWith(SKILL_FILE_SUFFIX)
      ? normalized.slice(0, -SKILL_FILE_SUFFIX.length)
      : undefined;
  }, [selected]);

  /**
   * Read one page of a directory, replacing the listing (`cursor` omitted) or
   * appending to it (`cursor` given).
   *
   * Keyed and attempt-stamped exactly as the other async slots here, so a read
   * still in flight when the user descends into a different directory — or
   * switches skills — cannot land afterwards and paint one directory's children
   * under another's path.
   */
  const readDirectory = useCallback(
    (uri: string, key: string, cursor?: string) => {
      if (!onReadResourceDirectory) return;
      const attempt = (nextAttempt.current += 1);
      /**
       * Commit a settled result, dropping it when it no longer belongs to the
       * pane on screen — a different skill, or a newer read of this one.
       */
      const commit = (
        next: (prev: DirectoryState) => Omit<DirectoryState, "key" | "attempt">,
      ) =>
        setDirectory((prev) => {
          if (prev.key !== null && prev.key !== key) return prev;
          if (prev.attempt !== undefined && prev.attempt > attempt) return prev;
          return { key, attempt, ...next(prev) };
        });
      // The path is claimed before the request goes out, so the header names
      // the directory being read rather than continuing to announce the
      // previous one for as long as the read takes.
      setDirectory((prev) =>
        prev.key !== null && prev.key !== key
          ? prev
          : {
              key,
              attempt,
              uri,
              // Pages accumulate, so a "load more" keeps what is on screen;
              // a fresh read of a different directory starts empty.
              children: cursor === undefined ? undefined : prev.children,
              loading: true,
            },
      );
      // A click handler cannot await, and this chain terminates in its own
      // `catch`, which surfaces the message in the section.
      void onReadResourceDirectory(uri, cursor)
        .then((page) => {
          commit((prev) => ({
            uri,
            children: [
              ...(cursor === undefined ? [] : (prev.children ?? [])),
              ...page.resources,
            ],
            nextCursor: page.nextCursor,
          }));
        })
        .catch((err: unknown) => {
          // A FAILED page leaves what is already on screen where it is, and
          // keeps the cursor that would retry it. Replacing the state outright
          // made the table vanish and stranded the reader with no way back to
          // that page short of restarting at the root (Copilot). Only a first
          // read of a directory has nothing to preserve.
          commit((prev) => ({
            uri,
            ...(cursor === undefined
              ? {}
              : { children: prev.children, nextCursor: cursor }),
            message: err instanceof Error ? err.message : String(err),
          }));
        });
    },
    [onReadResourceDirectory],
  );

  const fetchEntry = useCallback(() => {
    if (!selected) return;
    const key = manifestKey;
    const attempt = (nextAttempt.current += 1);
    // The verdict renders inside the Conformance section, which auto-collapses
    // for a clean entry — and a clean entry is exactly the common case for this
    // button. Without this the answer would land in a collapsed section and the
    // click would look like it did nothing. Called on the gesture, before the
    // request goes out — see `openConformance`.
    openConformance();
    // Same shape as the SKILL.md read: a click handler cannot await, the chain
    // ends in its own `catch`, and both arms drop a result whose manifest has
    // been invalidated or whose click has been superseded.
    const writeFetched = (next: Omit<FetchedEntryState, "key" | "attempt">) =>
      setFetchedEntry((prev) =>
        isStale(prev, key, attempt) ? prev : { key, attempt, ...next },
      );
    // Claimed before the request goes out — see `showSkillMd` for why settling
    // is too late.
    writeFetched({});
    void onGetSkill(selected.uri)
      .then((entry) => {
        // The fetched entry is checked ON ITS OWN before being compared. A
        // snapshot is allowed to have moved on, but it is not allowed to be
        // non-conforming: an entry missing a digest is invalid whether or not
        // the skill changed, and an entry for a DIFFERENT uri is never a valid
        // refresh of the one that was asked for. Only a conforming entry with
        // the same identity gets the benign "the snapshot moved" reading.
        writeFetched({
          entry,
          issues: checkSkillConformance(entry),
          // Compared by identity, not raw string: a server that canonicalizes
          // an escape has answered for the same resource, and calling that
          // "a different URI" would be the tool disagreeing with the read
          // path, which accepts exactly that equivalence.
          wrongUri:
            skillUriIdentity(entry.uri) !== skillUriIdentity(selected.uri),
          // Compared semantically — see `skillEntriesMatch` for why a
          // `JSON.stringify` comparison would report key order and manifest
          // order as differences.
          matches: skillEntriesMatch(entry, selected),
        });
      })
      .catch((err: unknown) => {
        writeFetched({
          message: err instanceof Error ? err.message : String(err),
        });
      });
  }, [manifestKey, onGetSkill, openConformance, selected]);

  const fetched = fetchedEntry.key === manifestKey ? fetchedEntry : undefined;
  // `invalid` outranks the snapshot comparison: an entry that breaks a
  // requirement, or answers for a different URI, is wrong regardless of
  // whether the skill it describes has changed since the listing.
  const fetchedVerdict =
    fetched?.wrongUri ||
    (fetched?.issues ?? []).some((issue) => issue.severity === "error")
      ? "invalid"
      : fetched?.matches
        ? "matches"
        : "differs";
  const batchRunning = batches.has(manifestKey);

  const previewCurrent = previewState.key === manifestKey;
  /**
   * The identities of every file the held entry's manifest lists.
   *
   * SEP-2640 is explicit that a directory read is *"a live observation that may
   * run ahead of or behind"* the entry, and that **"Hosts MUST NOT treat the
   * directory result as extending the manifest"** — a child the server lists
   * but the entry does not is, to a host acting on the skill, a verification
   * failure exactly as a digest mismatch is. The Inspector is not a host and
   * does not refuse the read; what it must not do is present such a child as
   * one of the skill's files without saying which view it came from. So the two
   * views are labelled rather than merged.
   *
   * Compared on the normalized identity, like every other URI comparison here.
   */
  const manifestIdentities = useMemo(
    () => new Set(manifest.map((resource) => skillUriIdentity(resource.uri))),
    [manifest],
  );

  // The directory slot, but only when it belongs to the current manifest —
  // same guard every other async slot on this screen uses.
  const directoryCurrent = directory.key === manifestKey;
  const directoryUri = directoryCurrent ? directory.uri : undefined;
  const directoryChildren = directoryCurrent ? directory.children : undefined;
  const directoryError = directoryCurrent ? directory.message : undefined;
  const directoryLoading = directoryCurrent && directory.loading === true;
  const directoryNextCursor = directoryCurrent
    ? directory.nextCursor
    : undefined;
  /**
   * Children the directory listed that the held entry's manifest does not.
   * Directories are excluded: a manifest lists files, so a directory is not a
   * missing entry. So is a `"dynamic"` skill, which advertises no manifest for
   * anything to be missing from.
   */
  const unlistedChildren = useMemo(() => {
    if (directoryChildren === undefined || isDynamic) return [];
    return directoryChildren.filter(
      (child) =>
        child.mimeType !== DIRECTORY_MIME_TYPE &&
        !manifestIdentities.has(skillUriIdentity(child.uri)),
    );
  }, [directoryChildren, isDynamic, manifestIdentities]);

  const preview = previewCurrent ? previewState.contents : undefined;
  const previewError = previewCurrent ? previewState.message : undefined;
  // The file the viewer is showing (or fetching). Falls back to the skill's own
  // URI so the heading is never blank on the very first frame, before the
  // selection effect has claimed a slot.
  const previewUri =
    (previewCurrent ? previewState.uri : undefined) ?? selectedUri;
  // One effective MIME for the displayed file, inferred the same way the
  // Resources screen infers one: servers routinely omit `mimeType` or answer a
  // generic `text/plain`, and the URI suffix is the better signal.
  // Whether the viewer is showing the skill's OWN SKILL.md. Compared by
  // identity, like every other URI comparison here.
  const showingSkillMd =
    previewUri !== undefined &&
    selectedUri !== undefined &&
    skillUriIdentity(previewUri) === skillUriIdentity(selectedUri);

  const previewMime = useMemo(() => {
    const declared = preview?.mimeType;
    const inferred =
      previewUri !== undefined ? inferMimeFromUri(previewUri) : undefined;
    // A SPECIFIC declared type wins — the server knows its own resource. A
    // *generic* one does not: servers routinely serve `SKILL.md` as
    // `text/plain` or `application/octet-stream`, and letting that outrank a
    // `.md` suffix meant a valid skill file was not recognised as markdown, so
    // its YAML stayed in the viewer and the Frontmatter section disappeared.
    const stated =
      declared !== undefined && !isGenericMime(declared)
        ? declared
        : (inferred ?? declared);
    if (stated !== undefined) return stated;
    // Markdown is the right last resort for a skill's OWN `SKILL.md` — SEP-2640
    // makes that file markdown by construction. It is the WRONG one for the
    // rest of a manifest, which the SEP expects to carry supporting scripts,
    // examples and assets with types of their own: an extensionless, untyped
    // blob would be decoded and rendered as markdown rather than falling back
    // to binary. `undefined` here hands the decision to `ContentViewer`, whose
    // own default is octet-stream for a blob and a text heuristic for text.
    return showingSkillMd ? "text/markdown" : undefined;
  }, [preview, previewUri, showingSkillMd]);

  // The displayed file, split once into frontmatter and body. BOTH halves of
  // the pane read from this single split, which is what keeps them honest: the
  // Frontmatter section shows the frontmatter of the file the viewer is
  // showing, and a file that has none renders no section at all rather than
  // leaving the previous file's on screen.
  //
  // Gated on the MIME being **markdown**, not on which payload arm the server
  // used. Keying on the arm got both halves of that wrong: a markdown file
  // served as a base64 `blob` — which this screen supports — kept its
  // frontmatter in the viewer and produced no Frontmatter section, while a
  // textual multi-document YAML resource had its first document silently
  // removed as "frontmatter". A blob is decoded here so a base64 SKILL.md
  // splits exactly like a text one.
  const previewParts = useMemo(() => {
    if (!isMarkdownMime(previewMime)) return undefined;
    const text =
      typeof preview?.text === "string"
        ? preview.text
        : preview?.blob !== undefined
          ? tryDecodeBase64ToUtf8(preview.blob)
          : null;
    return text === null || text === undefined
      ? undefined
      : splitSkillFile(text);
  }, [preview, previewMime]);

  // Which sections this skill actually renders — Frontmatter only exists when
  // the displayed file has any, so an "expand all" that named it unconditionally
  // would leave the toggle stuck reading "Expand" on a file without one.
  // The sections rendered RIGHT NOW. A dynamic skill renders no Resources
  // section, and Frontmatter is absent until the file has been read and turns
  // out to have any — so naming those unconditionally would leave "expand all"
  // permanently unsatisfied.
  //
  // This drives the toggle's *label* only. It must NOT be what "expand all"
  // writes: `openSections` outlives any one skill, so replacing it with the
  // currently-visible set silently drops the others. Pressing Expand all while
  // the SKILL.md read was still in flight removed `frontmatter`, and the
  // section then arrived collapsed with the control offering to expand all over
  // again; switching away from a dynamic skill did the same to `resources`.
  const sectionIds = useMemo(
    () => [
      "conformance",
      ...(isDynamic ? [] : ["resources"]),
      ...(onReadResourceDirectory && skillRoot !== undefined
        ? ["directory"]
        : []),
      ...(previewParts?.frontmatter !== undefined ? ["frontmatter"] : []),
      "resource",
    ],
    [isDynamic, onReadResourceDirectory, previewParts, skillRoot],
  );
  const allSectionsOpen = sectionIds.every((id) => openSections.includes(id));

  // Files whose bytes disagree with what the manifest advertised. A *runtime*
  // count, unlike the static findings beside it: it only exists once a
  // verification has actually run, which is why it renders as its own badge
  // rather than being folded into the error total — "2 error(s)" that changes
  // meaning after you press Verify would be the worse of the two options.
  //
  // Covers a size disagreement as well as a digest one: `verifySkillResource`
  // reports both as `mismatch`, the size check simply being the cheaper one
  // that runs first. The badge is therefore labelled "mismatch(es)" rather than
  // "digest mismatch(es)" — counting a size failure under a digest label would
  // misreport it, and dropping it from the count would hide a real failure.
  // The alerts below still distinguish the two by title.
  const mismatchCount = Object.values(fileStates).filter(
    (state) =>
      state.status === "done" && state.verification.status === "mismatch",
  ).length;

  /**
   * The SEP-2640 frontmatter cross-check, run against the file on screen — but
   * **only when that file is the skill's own `SKILL.md`**.
   *
   * The obligation is that the entry's `frontmatter` match the frontmatter of
   * the file the entry names; running it against a supporting file would report
   * `frontmatter-absent` for every one of them, which is the tool inventing a
   * defect. `showingSkillMd` is the same identity comparison the rest of this
   * screen uses.
   *
   * It is deliberately **not** part of the static `issues` above: those are
   * derived from the listing alone and are available the moment the list
   * arrives, while this one needs a `resources/read` the user asked for. Folding
   * them together would make the header badge's count change on its own the
   * first time a file happened to be fetched.
   */
  const frontmatterIssues = useMemo(() => {
    if (!selected) return [];
    // The skill-scoped text, whichever read produced it — so this verdict
    // survives the reader opening another file, and agrees with the digest
    // verdict when one verification produced both.
    if (entrySourceText !== undefined) {
      return checkSkillFrontmatterMatch(selected, entrySourceText);
    }
    if (!showingSkillMd || preview === undefined) return [];
    // Run against the **raw fetched bytes**, not against `previewParts`.
    //
    // `previewParts` is a *presentation* value: it only exists when the
    // displayed MIME is recognized as markdown, so a `SKILL.md` a server
    // labelled `text/plain` — or anything else — skipped this check entirely
    // while the report still read as clean (Copilot). The SEP makes the
    // comparison mandatory for the skill's own file regardless of how the
    // server typed it, and `showingSkillMd` already establishes that this IS
    // that file. Decoding the same bytes the digest is taken over also keeps
    // the two answers describing one payload rather than two derivations of it.
    let text: string;
    try {
      text = bytesToText(skillFileBytes(preview));
    } catch {
      // Neither text nor blob: there are no bytes to compare, and the file
      // viewer already reports the empty response. Inventing a frontmatter
      // finding here would name the wrong defect.
      return [];
    }
    return checkSkillFrontmatterMatch(selected, text);
  }, [selected, showingSkillMd, preview, entrySourceText]);

  /**
   * The findings rendered as list items — everything except the two that are
   * stated in prose above the list.
   *
   * Derived once and used for BOTH the "is there a list" decision and the list
   * itself. Deciding on `issues` while rendering the filtered set is how an
   * entry whose only finding is a banner one ended up showing an empty findings
   * container instead of "no structural issues".
   */
  /**
   * Reveal Conformance when the frontmatter check finds something.
   *
   * A structurally clean entry opens with the section COLLAPSED — the header
   * badge carries the whole answer — but the frontmatter findings arrive later,
   * from the `SKILL.md` read, and land inside that collapsed section. The badge
   * now counts them, so the number changes; the alerts explaining a mandatory
   * verification failure were still a click away (Copilot).
   *
   * Keyed on the entry so it fires **once** per skill, when findings first
   * appear, rather than fighting a user who deliberately collapses it again.
   * `useValueChange` runs during render and does only `setState`, as that hook
   * requires; the key is a primitive so `Object.is` cannot loop.
   */
  useValueChange(frontmatterIssues.length > 0 ? manifestKey : "", (next) => {
    if (next === "") return;
    setOpenSections((prev) =>
      prev.includes("conformance") ? prev : [...prev, "conformance"],
    );
  });

  const listedIssues = useMemo(
    () =>
      issues.filter(
        (issue) =>
          issue.code !== "dynamic-resources" && issue.code !== "duplicate-name",
      ),
    [issues],
  );

  /**
   * Everything the Conformance section reports, for the header badge.
   *
   * The frontmatter findings render inside this section, so counting only the
   * static listing issues left the badge saying `0 error(s)` above a red
   * `frontmatter-mismatch` alert — the section contradicting its own output
   * (Copilot). Digest and size mismatches stay OUT: they have their own
   * `mismatch(es)` badge, because "the listing is wrong" and "the bytes are
   * wrong" are different answers and merging them would hide which failed.
   */
  const countedIssues = useMemo(
    () => [...issues, ...frontmatterIssues],
    [issues, frontmatterIssues],
  );

  const errorCount = countedIssues.filter((i) => i.severity === "error").length;
  const warningCount = countedIssues.length - errorCount;

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
              // Not "No skills": SEP-2640 lets a server return an empty or
              // partial catalog, and says an empty result must not be read as
              // proof it has none — an unlisted skill can still be fetched by
              // URI with `skills/get`. Claiming otherwise would be the tool
              // asserting something the protocol explicitly does not.
              <EmptyState>No skills listed</EmptyState>
            ) : (
              filtered.map((skill) => {
                const skillIssues = checkSkillConformance(skill);
                const errors = skillIssues.filter(
                  (i) => i.severity === "error",
                ).length;
                return (
                  <NavLink
                    key={skill.uri}
                    active={
                      selectedSkillUri !== undefined &&
                      skillUriIdentity(skill.uri) ===
                        skillUriIdentity(selectedSkillUri)
                    }
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
          <DetailColumn data-testid="skill-detail">
            <SectionControlsRow>
              <Stack gap={4}>
                <SkillTitle>{skillDisplayName(selected)}</SkillTitle>
                <SkillUriCaption title={selected.uri}>
                  {selected.uri}
                </SkillUriCaption>
              </Stack>
              {/* Both actions act on the whole skill, so they live on the
                  pane's header rather than inside a section — and a button
                  inside an `Accordion.Control` would toggle that section on its
                  way to firing. */}
              <InlineRow>
                <FetchButton onClick={fetchEntry}>
                  Fetch with skills/get
                </FetchButton>
                <VerifyButton
                  onClick={verifyAll}
                  disabled={manifest.length === 0 || batchRunning}
                  loading={batchRunning}
                >
                  Verify all
                </VerifyButton>
                {/* The app's shared expand/collapse-all control, the same one
                    `ResourceControls` puts on its disclosure accordion.
                    `compact` means "currently collapsed", so it is the negation
                    of everything being open. */}
                <ListToggle
                  variant="subtle"
                  compact={!allSectionsOpen}
                  // Expands to the COMPLETE section set, not the visible one —
                  // see `sectionIds` for what writing the visible set dropped.
                  onToggle={() =>
                    setOpenSections(allSectionsOpen ? [] : [...ALL_SECTIONS])
                  }
                />
              </InlineRow>
            </SectionControlsRow>

            {selected.frontmatter.description && (
              <SkillDescription title={selected.frontmatter.description}>
                {selected.frontmatter.description}
              </SkillDescription>
            )}

            {/* Inline, not a `.withProps()` subcomponent: `Accordion` is a
                compound, `multiple`-discriminated generic, and baking props
                into it loses the JSX call signature (see AGENTS.md).

                `variant="disclosure"` is the app's existing full-height
                sections mechanism (#1462, also used by `ResourceControls`): the
                headers stay pinned and each open panel scrolls within its own
                share of the space, which is exactly what keeps this pane from
                scrolling as one column. */}
            {/* Each `Accordion.Panel` is a scroll container under the
                `skillSections` variant, so every one carries `tabIndex={0}`:
                axe's `scrollable-region-focusable` requires a scrollable region
                to be keyboard-reachable, and a panel whose content holds no
                focusable element (the Conformance alerts, for instance) is
                otherwise unscrollable without a pointer. */}
            <Accordion
              // Keyed by the manifest so a skill change gives every panel a
              // FRESH scroll container. `scrollTop` lives on the DOM node, not
              // in React state, so reusing these panels carried one skill's
              // scroll position into the next — switching between two long
              // manifests showed the new one part-way down with its first rows
              // hidden, which reads as missing data rather than as scroll.
              // `openSections` is controlled, so it survives the remount.
              key={manifestKey}
              multiple
              variant="skillSections"
              chevron={<RiArrowRightSLine />}
              flex={1}
              mih={0}
              // Mantine's panel height animation fights the flex sizing above;
              // the chevron still rotates smoothly via App.css (#1462).
              transitionDuration={0}
              value={openSections}
              onChange={setOpenSections}
            >
              <Accordion.Item
                value="conformance"
                flex={SECTION_FLEX}
                mih={
                  openSections.includes("conformance")
                    ? OPEN_SECTION_MIN_HEIGHT
                    : undefined
                }
              >
                <Accordion.Control>
                  <InlineRow>
                    <SectionHeading>Conformance</SectionHeading>
                    <CountBadge color={summaryColor(errorCount, warningCount)}>
                      {errorCount} error(s), {warningCount} warning(s)
                    </CountBadge>
                    {/* Only once something has actually failed verification —
                        a permanent "0 digest mismatches" would read as a
                        verified result before anything had been checked. */}
                    {mismatchCount > 0 && (
                      <CountBadge color="red">
                        {mismatchCount} mismatch(es)
                      </CountBadge>
                    )}
                  </InlineRow>
                </Accordion.Control>
                <Accordion.Panel tabIndex={0}>
                  <ConformanceStack>
                    {/* A dynamic skill's `dynamic-resources` finding is
                        rendered here in full rather than as a bare code and
                        message, and the Resources section is dropped entirely —
                        otherwise the same fact is stated twice, once as a
                        finding and once as an empty section's explanation. */}
                    {isDynamic && (
                      <Alert color="yellow" title="Dynamic resources">
                        This skill declares{" "}
                        <Code>resources: &quot;dynamic&quot;</Code> — its files
                        are generated, so no manifest is advertised and
                        integrity cannot be verified.
                      </Alert>
                    )}
                    {/* A name collision is a fact about the LISTING rather
                        than about this entry, so it is stated in prose at the
                        top of the section and filtered out of the findings
                        list below — the same treatment, and the same reason, as
                        `dynamic-resources`: the same fact twice, once as a
                        banner and once as a bare code, reads as two findings.
                        It leads the section because it changes how everything
                        under it should be read — these are the findings for
                        ONE of two skills the server named the same thing. */}
                    {collision && (
                      <Alert
                        color="yellow"
                        title="Another skill shares this name"
                        data-testid="skill-name-collision"
                      >
                        {collision.message}
                      </Alert>
                    )}
                    {listedIssues.length === 0 ? (
                      // Titled for the check it actually summarises. Now that
                      // every verdict renders in this one section, an
                      // unqualified "Conforms" sits directly above a red digest
                      // mismatch and flatly contradicts it — the static checks
                      // passing says nothing about the bytes.
                      <Alert color="green" title="No structural issues">
                        No structural issues found in this entry.
                      </Alert>
                    ) : (
                      <IssueStack data-testid="skill-issues">
                        {listedIssues.map((issue, index) => (
                          <Alert
                            // The index is load-bearing, not decoration: a
                            // manifest repeating one URI three times yields
                            // three `duplicate-resource` findings with
                            // identical code and URI, and a key built from
                            // those alone would make React drop the extras —
                            // hiding findings in exactly the malformed input
                            // this view exists to inspect.
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
                    {/* The frontmatter cross-check renders in Conformance
                        rather than beside the Frontmatter section, because it
                        is a *finding about the entry* and every other finding
                        about the entry is here — a reader checking "does this
                        skill conform" must not have to know that one class of
                        violation is filed somewhere else. */}
                    {frontmatterIssues.length > 0 && (
                      <IssueStack data-testid="skill-frontmatter-issues">
                        {frontmatterIssues.map((issue, index) => (
                          <Alert
                            key={`frontmatter:${index}`}
                            color={issueColor(issue)}
                            title={issue.code}
                          >
                            <Text size="sm">{issue.message}</Text>
                          </Alert>
                        ))}
                      </IssueStack>
                    )}
                    {manifest.map((resource, index) => {
                      const state = fileStates[index];
                      if (state?.status === "done") {
                        const result = state.verification;
                        if (result.status !== "mismatch") return null;
                        // A size disagreement is caught BEFORE hashing, so it
                        // has no `actualDigest` — titling it "Digest
                        // mismatch" and rendering "actual undefined" would
                        // hide the real failure.
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
                    {fetched?.message !== undefined && (
                      <Alert color="red" title="skills/get failed">
                        {fetched.message}
                      </Alert>
                    )}
                    {fetched?.entry !== undefined && (
                      <Alert
                        data-testid="skills-get-result"
                        data-verdict={fetchedVerdict}
                        // Red only for a genuine violation — a non-conforming entry,
                        // or one answering with a different URI, neither of which a
                        // fresh snapshot excuses. A conforming entry that merely
                        // moved on is yellow: `skills/get` IS a point-in-time read,
                        // so a changed skill legitimately differs.
                        color={
                          fetchedVerdict === "invalid"
                            ? "red"
                            : fetchedVerdict === "matches"
                              ? "green"
                              : "yellow"
                        }
                        title={
                          fetchedVerdict === "invalid"
                            ? "skills/get returned a non-conforming entry"
                            : fetchedVerdict === "matches"
                              ? "skills/get matches skills/list"
                              : "skills/get returned a different snapshot"
                        }
                      >
                        <Stack gap={2}>
                          <Text size="sm">
                            {fetchedVerdict === "invalid"
                              ? fetched.wrongUri
                                ? "This entry is for a different URI than the one requested, which is never a valid refresh of it."
                                : "The returned entry does not conform to SEP-2640, so this is not simply a skill that changed since it was listed."
                              : fetchedVerdict === "matches"
                                ? "The entry this server returns for this URI describes the same skill it listed (compared ignoring key and manifest order)."
                                : "The entry this server returns for this URI differs from the one it listed. `skills/get` is a fresh snapshot, so this is expected if the skill changed since the list was fetched — and a server inconsistency if it did not."}
                          </Text>
                          {fetchedVerdict !== "matches" && (
                            <ContentViewer
                              block={{
                                type: "text",
                                text: JSON.stringify(fetched.entry, null, 2),
                              }}
                              mimeType="application/json"
                              jsonLabel="Fetched skill entry"
                              copyable
                            />
                          )}
                          {/* Under the entry, not above it: each finding names
                              a field, so it reads as an annotation on the JSON
                              the reader has just been shown rather than a
                              preamble to something not yet on screen. */}
                          {(fetched.issues ?? [])
                            .filter((issue) => issue.severity === "error")
                            .map((issue, index) => (
                              <MonoCaption key={`${index}:${issue.code}`}>
                                {issue.code}: {issue.message}
                              </MonoCaption>
                            ))}
                        </Stack>
                      </Alert>
                    )}
                  </ConformanceStack>
                </Accordion.Panel>
              </Accordion.Item>

              {/* A dynamic skill advertises no manifest, so there is no manifest
                  to show — the Conformance banner above says so once. */}
              {!isDynamic && (
                <Accordion.Item
                  value="resources"
                  flex={SECTION_FLEX}
                  mih={
                    openSections.includes("resources")
                      ? OPEN_SECTION_MIN_HEIGHT
                      : undefined
                  }
                >
                  <Accordion.Control>
                    <InlineRow>
                      <SectionHeading>Resources</SectionHeading>
                      <CountBadge>
                        {manifest.length} file(s), {totalSkillBytes(manifest)}{" "}
                        bytes
                      </CountBadge>
                    </InlineRow>
                  </Accordion.Control>
                  <Accordion.Panel tabIndex={0}>
                    <Stack gap="xs">
                      <ManifestTable data-testid="skill-manifest">
                        <Table.Thead>
                          <Table.Tr>
                            <Table.Th>URI</Table.Th>
                            <Table.Th>Size</Table.Th>
                            <Table.Th>Digest</Table.Th>
                            <Table.Th>Verification</Table.Th>
                            {/* The action gets its own column so the buttons
                                line up down the table. Sharing a cell with
                                the verdict badge staggered them, because the
                                badge's width tracks its label — "—",
                                "checking…", "verified" and "mismatch" are all
                                different sizes.

                                The header is named for screen readers but not
                                shown: a visible label over a column of
                                buttons is noise, while an *empty* `th` is an
                                axe `empty-table-header` violation and leaves
                                the column unnamed in a table's header
                                navigation. */}
                            <Table.Th>
                              <VisuallyHidden>Actions</VisuallyHidden>
                            </Table.Th>
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
                            // Compared by identity for the same reason every
                            // other URI comparison here is: a server that
                            // canonicalizes an escape is naming the same
                            // file, and the row the user just clicked must
                            // not read as unselected because of a spelling.
                            const showing =
                              previewUri !== undefined &&
                              skillUriIdentity(resource.uri) ===
                                skillUriIdentity(previewUri);
                            return (
                              // Index-keyed for the same reason the verdicts
                              // are: a duplicated URI is a case this screen
                              // reports, so it must not also collide two rows
                              // into one.
                              <Table.Tr key={index}>
                                <Table.Td>
                                  <ResourceUriButton
                                    variant={showing ? "light" : "subtle"}
                                    aria-current={showing ? "true" : undefined}
                                    onClick={() =>
                                      showResource(
                                        resource.uri,
                                        manifestKey,
                                        isSelfResource(resource),
                                      )
                                    }
                                  >
                                    {resource.uri}
                                  </ResourceUriButton>
                                </Table.Td>
                                <Table.Td>{resource.size ?? "—"}</Table.Td>
                                <Table.Td>
                                  {shortDigest(resource.digest)}
                                </Table.Td>
                                <Table.Td>
                                  <CountBadge color={color}>
                                    {verificationLabel(state)}
                                  </CountBadge>
                                </Table.Td>
                                <ActionCell>
                                  <RowVerifyButton
                                    // Every row's button reads "Verify", so
                                    // the visible text alone gives a screen-
                                    // reader user no way to tell which file
                                    // each one checks; the URI cell is in the
                                    // same row but is not programmatically
                                    // associated with it.
                                    aria-label={`Verify ${resource.uri}`}
                                    // A click handler cannot await, and
                                    // `verifyRow` owns its own failures — it
                                    // records them as this row's state. The
                                    // section is opened HERE, on the gesture,
                                    // not inside `verifyRow` — see
                                    // `openConformance`.
                                    onClick={() => {
                                      openConformance();
                                      void verifyRow(
                                        index,
                                        resource,
                                        manifestKey,
                                        isSelfResource(resource),
                                      );
                                    }}
                                  >
                                    Verify
                                  </RowVerifyButton>
                                </ActionCell>
                              </Table.Tr>
                            );
                          })}
                        </Table.Tbody>
                      </ManifestTable>
                    </Stack>
                  </Accordion.Panel>
                </Accordion.Item>
              )}

              {/* Gated on the CALLBACK, which the parent supplies only when
                  the server declared `directoryRead`. SEP-2640 makes calling
                  `resources/directory/read` against a server that has not
                  declared it a MUST NOT, so an absent section is that rule
                  rather than a UI preference. */}
              {onReadResourceDirectory && skillRoot !== undefined && (
                <Accordion.Item
                  value="directory"
                  flex={SECTION_FLEX}
                  mih={
                    openSections.includes("directory")
                      ? OPEN_SECTION_MIN_HEIGHT
                      : undefined
                  }
                >
                  <Accordion.Control>
                    <SectionHeading>Directory</SectionHeading>
                  </Accordion.Control>
                  <Accordion.Panel tabIndex={0}>
                    <Stack gap="xs">
                      {/* Read on a click, never on selection. A directory read
                          is a live round trip, and this screen's posture is
                          that every one of them is asked for — the same reason
                          "Fetch entry" is a button and not an effect. */}
                      <SectionControlsRow>
                        <MonoCaption>{directoryUri ?? skillRoot}</MonoCaption>
                        <Group gap="xs">
                          {/* Ascending is bounded by the skill root: this
                              section browses the selected skill's tree, and
                              walking above it would leave the subject of every
                              other section on screen. */}
                          {directoryUri !== undefined &&
                            directoryUri !== skillRoot && (
                              <FetchButton
                                onClick={() =>
                                  readDirectory(
                                    directoryUri.slice(
                                      0,
                                      directoryUri.lastIndexOf("/"),
                                    ),
                                    manifestKey,
                                  )
                                }
                              >
                                Up
                              </FetchButton>
                            )}
                          <FetchButton
                            loading={directoryLoading}
                            onClick={() =>
                              readDirectory(skillRoot, manifestKey)
                            }
                          >
                            {directoryChildren === undefined
                              ? "Read directory"
                              : "Reload root"}
                          </FetchButton>
                        </Group>
                      </SectionControlsRow>
                      {directoryError !== undefined && (
                        <ReadFailureAlert>{directoryError}</ReadFailureAlert>
                      )}
                      {/* Stated in prose the first time the two views
                          disagree, because the per-row chip alone does not say
                          why it matters — and "the skill changed and needs
                          re-approval" is what SEP-2640 asks a host to present
                          here, rather than a read error. */}
                      {unlistedChildren.length > 0 && (
                        <UnlistedChildrenAlert data-testid="skill-directory-unlisted">
                          The server is serving {unlistedChildren.length} file
                          {unlistedChildren.length === 1 ? "" : "s"} here that
                          the held <Code>skills/list</Code> entry does not
                          declare. A directory read is a live observation and
                          does <strong>not</strong> extend the manifest: to a
                          host acting on this skill, reading one of these is a
                          verification failure equivalent to a digest mismatch.
                          Re-fetch the entry with <Code>skills/get</Code> to see
                          whether the skill has changed.
                        </UnlistedChildrenAlert>
                      )}
                      {directoryChildren !== undefined &&
                        (directoryChildren.length === 0 ? (
                          <EmptyState>This directory is empty.</EmptyState>
                        ) : (
                          <ManifestTable data-testid="skill-directory">
                            <Table.Thead>
                              <Table.Tr>
                                <Table.Th>Name</Table.Th>
                                <Table.Th>URI</Table.Th>
                                <Table.Th>MIME type</Table.Th>
                                <Table.Th>In manifest</Table.Th>
                              </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                              {directoryChildren.map((child, index) => {
                                const isDir =
                                  child.mimeType === DIRECTORY_MIME_TYPE;
                                // A server can return a child pointing
                                // anywhere. Descending into one leaves the
                                // selected skill's tree, and the "Up" control
                                // only compares against `skillRoot` — so the
                                // walk could then continue outside it entirely
                                // (Copilot). Containment is decided on the
                                // NORMALIZED URI, like every containment check
                                // in `core/mcp/skills.ts`, so a `..` segment
                                // cannot walk out while still matching as a
                                // prefix.
                                const childUri = normalizeSkillUri(child.uri);
                                const inRoot =
                                  childUri !== undefined &&
                                  skillRoot !== undefined &&
                                  (childUri === skillRoot ||
                                    childUri.startsWith(`${skillRoot}/`));
                                // A directory is not a manifest entry in the
                                // first place — a manifest lists files — so it
                                // is neither listed nor unlisted and gets no
                                // verdict rather than a misleading "no".
                                const listed = manifestIdentities.has(
                                  skillUriIdentity(child.uri),
                                );
                                return (
                                  // Index-keyed for the same reason the
                                  // manifest rows are: a server repeating a URI
                                  // is a defect to display, not two rows to
                                  // collapse into one.
                                  <Table.Tr key={index}>
                                    <Table.Td>
                                      {!inRoot ? (
                                        // Shown, never navigable. The reader
                                        // should see what the server sent, and
                                        // a child outside the skill it was
                                        // asked about is itself the finding.
                                        <NoVerdictText>
                                          {child.name} (outside this skill)
                                        </NoVerdictText>
                                      ) : (
                                        <ResourceUriButton
                                          // A directory descends; a file opens in
                                          // the viewer below. One column, two
                                          // destinations, so the label says which
                                          // for a reader who cannot see the MIME
                                          // column at a glance.
                                          aria-label={
                                            isDir
                                              ? `Open directory ${child.uri}`
                                              : `View ${child.uri}`
                                          }
                                          onClick={() =>
                                            isDir
                                              ? readDirectory(
                                                  child.uri,
                                                  manifestKey,
                                                )
                                              : showResource(
                                                  child.uri,
                                                  manifestKey,
                                                )
                                          }
                                        >
                                          {isDir
                                            ? `${child.name}/`
                                            : child.name}
                                        </ResourceUriButton>
                                      )}
                                    </Table.Td>
                                    <Table.Td>
                                      <MonoCaption>{child.uri}</MonoCaption>
                                    </Table.Td>
                                    <Table.Td>{child.mimeType ?? "—"}</Table.Td>
                                    <Table.Td>
                                      {isDir || isDynamic ? (
                                        <NoVerdictText>—</NoVerdictText>
                                      ) : (
                                        <CountBadge
                                          color={listed ? "green" : "yellow"}
                                        >
                                          {listed ? "listed" : "not listed"}
                                        </CountBadge>
                                      )}
                                    </Table.Td>
                                  </Table.Tr>
                                );
                              })}
                            </Table.Tbody>
                          </ManifestTable>
                        ))}
                      {/* Paging is manual because the SEP gives the cursor to
                          the client and this screen is what a server author
                          uses to see their own pagination work. Auto-walking it
                          would hide exactly the behaviour under test. */}
                      {directoryNextCursor !== undefined &&
                        directoryUri !== undefined && (
                          <FetchButton
                            loading={directoryLoading}
                            onClick={() =>
                              readDirectory(
                                directoryUri,
                                manifestKey,
                                directoryNextCursor,
                              )
                            }
                          >
                            Load more
                          </FetchButton>
                        )}
                    </Stack>
                  </Accordion.Panel>
                </Accordion.Item>
              )}

              {/* Rendered ONLY when the file on display actually carries
                  frontmatter. A skill's manifest files generally do not, and a
                  section that lingered would be showing the previously selected
                  file's fields against the current file's name. */}
              {previewParts?.frontmatter !== undefined && (
                <Accordion.Item
                  value="frontmatter"
                  // Weight 1: frontmatter is a handful of lines whatever the
                  // file, so it never needs a share proportional to anything.
                  flex={SECTION_FLEX}
                  mih={
                    openSections.includes("frontmatter")
                      ? OPEN_SECTION_MIN_HEIGHT
                      : undefined
                  }
                >
                  <Accordion.Control>
                    <SectionHeading>Frontmatter</SectionHeading>
                  </Accordion.Control>
                  <Accordion.Panel tabIndex={0}>
                    <FramedContent>
                      {/* `CodeHighlight` directly, NOT `ContentViewer`.
                          The promise this section makes is the bytes the server
                          served, and `ContentViewer`'s plain-text branch
                          pretty-prints anything that parses as JSON — which
                          every JSON mapping is also valid YAML, so a
                          frontmatter of `{"name":"a"}` came back re-serialised
                          while the section claimed to be showing it verbatim.
                          For a conformance tool that is the one thing this must
                          not do. */}
                      <CodeHighlight
                        language="yaml"
                        code={previewParts.frontmatter}
                      />
                    </FramedContent>
                  </Accordion.Panel>
                </Accordion.Item>
              )}

              <Accordion.Item
                value="resource"
                // The one section that GROWS, and the one whose basis must be
                // zero — see `viewerFlex` for what a content-sized basis did to
                // its siblings.
                flex={viewerFlex(openSections.includes("resource"))}
                mih={
                  openSections.includes("resource")
                    ? OPEN_SECTION_MIN_HEIGHT
                    : undefined
                }
              >
                <Accordion.Control>
                  <ResourceHeaderRow>
                    <SectionHeading>Skill Resource</SectionHeading>
                    {previewUri !== undefined && (
                      <ResourceNameCaption title={previewUri}>
                        {resourceFileName(previewUri)}
                      </ResourceNameCaption>
                    )}
                  </ResourceHeaderRow>
                </Accordion.Control>
                <Accordion.Panel
                  tabIndex={0}
                  data-testid="skill-resource-viewer"
                >
                  {previewError !== undefined ? (
                    <Alert color="red" title="Could not read this resource">
                      {previewError}
                    </Alert>
                  ) : (
                    preview && (
                      /* `contents`, not a text `block`: a server may serve a
                         skill file as a base64 `blob`, and the block form would
                         substitute an empty string and paint a blank viewer for
                         a file it had just read correctly.

                         When the file split, the decoded BODY is handed over as
                         text regardless of which arm the server used — that is
                         what lets a base64 markdown file lose its frontmatter
                         to the section above like a text one. Anything that did
                         not split is passed through in its original arm. */
                      <ContentViewer
                        contents={
                          previewParts !== undefined
                            ? {
                                uri: previewUri ?? selected.uri,
                                text: previewParts.body,
                                mimeType: previewMime,
                              }
                            : typeof preview.text === "string"
                              ? {
                                  uri: previewUri ?? selected.uri,
                                  text: preview.text,
                                  mimeType: previewMime,
                                }
                              : {
                                  uri: previewUri ?? selected.uri,
                                  blob: preview.blob ?? "",
                                  mimeType: previewMime,
                                }
                        }
                        copyable
                      />
                    )
                  )}
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>
          </DetailColumn>
        )}
      </DetailCard>
    </ScreenLayout>
  );
}
