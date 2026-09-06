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
  ScrollArea,
  Stack,
  Table,
  Text,
  TextInput,
} from "@mantine/core";
import { MdRefresh, MdSearch, MdVerifiedUser } from "react-icons/md";
import { RiArrowRightSLine } from "react-icons/ri";
import type {
  SkillEntry,
  SkillResource,
} from "@inspector/core/mcp/skillsSchemas.js";
import { DYNAMIC_RESOURCES } from "@inspector/core/mcp/skillsSchemas.js";
import {
  checkSkillConformance,
  skillDisplayName,
  skillEntriesMatch,
  skillUriIdentity,
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
import { splitSkillFile } from "../../../utils/splitSkillFile";

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

// The transient `skills/get` verdict sits between the sections and the viewer,
// so it is the one part of the column that may need to scroll on its own.
const FetchResultScroll = ScrollArea.withProps({
  type: "auto",
  scrollbars: "y",
  offsetScrollbars: true,
  flex: "0 1 auto",
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

const RefreshButton = Button.withProps({
  variant: "subtle",
  size: "compact-xs",
  leftSection: <MdRefresh aria-hidden size={14} />,
});

// The shield is a claim about integrity, so it belongs only on the controls
// that actually check it — "Verify all" and the per-row "Verify". `skills/get`
// re-fetches an entry and compares it against the listing; that is a
// consistency check, not a digest verification, and the icon would overstate
// what the button does.
const VerifyButton = Button.withProps({
  variant: "light",
  size: "compact-sm",
  leftSection: <MdVerifiedUser aria-hidden size={14} />,
});

const FetchButton = Button.withProps({
  variant: "light",
  size: "compact-sm",
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

const IssueStack = Stack.withProps({
  gap: "xs",
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

const RowVerifyButton = Button.withProps({
  variant: "subtle",
  size: "compact-xs",
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
 * Per-section flex for the disclosure accordion, the same shape
 * `ResourceControls` uses (#1462): an open section shrinks in proportion to how
 * much it holds, so a long one gives up space before a short one has to scroll,
 * and `flex-grow: 0` means nothing expands until the content actually
 * overflows. A closed section stays at its header height.
 */
function sectionFlex(open: boolean, count: number): string {
  return open && count > 0 ? `0 ${count} auto` : "0 0 auto";
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
 * verification verdict. Verification is on demand: SEP-2640 says a
 * `resources/read` of a skill file is not a load and confers no standing, so
 * the Inspector fetches only what the user asks it to.
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
  // Which of the four collapsible sections are open. A view preference, so it
  // is deliberately NOT reset by the manifest-change invalidation below — a
  // user who collapsed the frontmatter wants it collapsed on the next skill
  // too. Conformance, Resources and the file viewer start open because they are
  // what the screen exists to show; the frontmatter is reference material.
  const [openSections, setOpenSections] = useState<string[]>([
    "conformance",
    "resources",
    "resource",
  ]);
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
    () =>
      `${sessionKey}\n${selected ? JSON.stringify(selected) : (selectedSkillUri ?? "")}`,
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

  /**
   * Put one of the skill's files in the viewer. Driven both by the effect that
   * loads `SKILL.md` on selection and by the manifest's URI buttons.
   *
   * The manifest `key` is a parameter rather than a closure read, so the
   * selection effect below can pass the manifest it is loading *for* instead of
   * whichever one happened to be current when this callback was created.
   */
  const showResource = useCallback(
    (uri: string, key: string) => {
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
        .then((contents) => writePreview({ uri, contents }))
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

  useEffect(() => {
    if (selectedUri === undefined) return;
    showResource(selectedUri, manifestKey);
  }, [manifestKey, selectedUri, showResource]);

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
  }, [manifestKey, onGetSkill, selected]);

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
  const preview = previewCurrent ? previewState.contents : undefined;
  const previewError = previewCurrent ? previewState.message : undefined;
  // The file the viewer is showing (or fetching). Falls back to the skill's own
  // URI so the heading is never blank on the very first frame, before the
  // selection effect has claimed a slot.
  const previewUri =
    (previewCurrent ? previewState.uri : undefined) ?? selectedUri;
  // The displayed file, split once into frontmatter and body. BOTH halves of
  // the pane read from this single split, which is what keeps them honest: the
  // Frontmatter section shows the frontmatter of the file the viewer is
  // showing, and a file that has none renders no section at all rather than
  // leaving the previous file's on screen.
  //
  // Only the text form can be split; a base64 `blob` is served through
  // untouched.
  const previewParts = useMemo(
    () =>
      typeof preview?.text === "string"
        ? splitSkillFile(preview.text)
        : undefined,
    [preview],
  );

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
                <MonoCaption>{selected.uri}</MonoCaption>
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
              </InlineRow>
            </SectionControlsRow>

            {selected.frontmatter.description && (
              <Text size="sm">{selected.frontmatter.description}</Text>
            )}

            {/* Inline, not a `.withProps()` subcomponent: `Accordion` is a
                compound, `multiple`-discriminated generic, and baking props
                into it loses the JSX call signature (see AGENTS.md).

                `variant="disclosure"` is the app's existing full-height
                sections mechanism (#1462, also used by `ResourceControls`): the
                headers stay pinned and each open panel scrolls within its own
                share of the space, which is exactly what keeps this pane from
                scrolling as one column. */}
            <Accordion
              multiple
              variant="disclosure"
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
                flex={sectionFlex(
                  openSections.includes("conformance"),
                  Math.max(issues.length, 1),
                )}
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
                  </InlineRow>
                </Accordion.Control>
                <Accordion.Panel>
                  {issues.length === 0 ? (
                    <Alert color="green" title="Conforms">
                      No structural issues found in this entry.
                    </Alert>
                  ) : (
                    <IssueStack data-testid="skill-issues">
                      {issues.map((issue, index) => (
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
                </Accordion.Panel>
              </Accordion.Item>

              <Accordion.Item
                value="resources"
                flex={sectionFlex(
                  openSections.includes("resources"),
                  Math.max(manifest.length, 1),
                )}
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
                <Accordion.Panel>
                  <Stack gap="xs">
                    {selected.resources === DYNAMIC_RESOURCES ? (
                      <Alert color="yellow" title="Dynamic resources">
                        This skill declares{" "}
                        <Code>resources: &quot;dynamic&quot;</Code> — its files
                        are generated, so no manifest is advertised and
                        integrity cannot be verified.
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
                                      showResource(resource.uri, manifestKey)
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
                                  <InlineRow>
                                    <CountBadge color={color}>
                                      {verificationLabel(state)}
                                    </CountBadge>
                                    <RowVerifyButton
                                      // Every row's button reads "Verify", so
                                      // the visible text alone gives a screen-
                                      // reader user no way to tell which file
                                      // each one checks; the URI cell is in
                                      // the same row but is not
                                      // programmatically associated with it.
                                      aria-label={`Verify ${resource.uri}`}
                                      // A click handler cannot await, and
                                      // `verifyRow` owns its own failures — it
                                      // records them as this row's state.
                                      onClick={() =>
                                        void verifyRow(
                                          index,
                                          resource,
                                          manifestKey,
                                        )
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
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>

              {/* Rendered ONLY when the file on display actually carries
                  frontmatter. A skill's manifest files generally do not, and a
                  section that lingered would be showing the previously selected
                  file's fields against the current file's name. */}
              {previewParts?.frontmatter !== undefined && (
                <Accordion.Item
                  value="frontmatter"
                  // Weight 1: frontmatter is a handful of lines whatever the
                  // file, so it never needs a share proportional to anything.
                  flex={sectionFlex(openSections.includes("frontmatter"), 1)}
                  mih={
                    openSections.includes("frontmatter")
                      ? OPEN_SECTION_MIN_HEIGHT
                      : undefined
                  }
                >
                  <Accordion.Control>
                    <SectionHeading>Frontmatter</SectionHeading>
                  </Accordion.Control>
                  <Accordion.Panel>
                    <FramedContent>
                      {/* The raw YAML the server served, not a re-serialised
                          object: this app carries no YAML parser, and for a
                          conformance tool the bytes on the wire are the more
                          useful answer anyway. */}
                      <ContentViewer
                        block={{
                          type: "text",
                          text: previewParts.frontmatter,
                        }}
                        mimeType="text/yaml"
                        copyable
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
                  <SectionControlsRow>
                    <SectionHeading>Skill Resource</SectionHeading>
                    {previewUri !== undefined && (
                      <MonoCaption>{resourceFileName(previewUri)}</MonoCaption>
                    )}
                  </SectionControlsRow>
                </Accordion.Control>
                <Accordion.Panel data-testid="skill-resource-viewer">
                  {previewError !== undefined ? (
                    <Alert color="red" title="Could not read this resource">
                      {previewError}
                    </Alert>
                  ) : (
                    preview && (
                      /* `contents`, not a text `block`: a server may serve a
                         skill file as a base64 `blob`, and the block form would
                         substitute an empty string and paint a blank viewer for
                         a file it had just read correctly. */
                      <ContentViewer
                        contents={
                          typeof preview.text === "string"
                            ? {
                                uri: previewUri ?? selected.uri,
                                // The body half of the same split the
                                // Frontmatter section reads from.
                                text: previewParts?.body ?? preview.text,
                                mimeType: preview.mimeType ?? "text/markdown",
                              }
                            : {
                                uri: previewUri ?? selected.uri,
                                blob: preview.blob ?? "",
                                mimeType: preview.mimeType ?? "text/markdown",
                              }
                        }
                        copyable
                      />
                    )
                  )}
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>

            <FetchResultScroll>
              {fetched?.message !== undefined && (
                <Alert color="red" title="skills/get failed">
                  {fetched.message}
                </Alert>
              )}
              {fetched?.entry !== undefined && (
                <Alert
                  data-testid="skills-get-result"
                  data-verdict={fetchedVerdict}
                  mt="sm"
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
                          : "This entry breaks a requirement of its own, so the difference is not simply a newer snapshot."
                        : fetchedVerdict === "matches"
                          ? "The entry this server returns for this URI describes the same skill it listed (compared ignoring key and manifest order)."
                          : "The entry this server returns for this URI differs from the one it listed. `skills/get` is a fresh snapshot, so this is expected if the skill changed since the list was fetched — and a server inconsistency if it did not."}
                    </Text>
                    {(fetched.issues ?? [])
                      .filter((issue) => issue.severity === "error")
                      .map((issue, index) => (
                        <MonoCaption key={`${index}:${issue.code}`}>
                          {issue.code}: {issue.message}
                        </MonoCaption>
                      ))}
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
                  </Stack>
                </Alert>
              )}
            </FetchResultScroll>
          </DetailColumn>
        )}
      </DetailCard>
    </ScreenLayout>
  );
}
