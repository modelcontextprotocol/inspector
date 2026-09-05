import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { SkillEntry } from "@inspector/core/mcp/skillsSchemas";
import { sha256Digest, textToBytes } from "@inspector/core/mcp/skills";
import {
  renderWithMantine,
  screen,
  waitFor,
  within,
} from "../../../test/renderWithMantine";
import {
  SkillsScreen,
  type SkillsScreenProps,
  type SkillsUiState,
} from "./SkillsScreen";
import { EMPTY_SKILLS_UI } from "../screenUiState";

const REF_TEXT = "# Column rules\n";
const SELF_TEXT = "# data-analysis\n";
const NOTES_TEXT = "different\n";
// Computed once at module load so each fixture's advertised digest really is
// the digest of the bytes the fake read returns — a hard-coded constant would
// make the "verified" test pass for the wrong reason if the encoder changed.
const REF_DIGEST = await sha256Digest(textToBytes(REF_TEXT));
const SELF_DIGEST = await sha256Digest(textToBytes(SELF_TEXT));

// Every manifest lists the skill's own SKILL.md: a manifest is the complete
// file set, so one that omits it is a `manifest-missing-self` error and no
// fixture here would be "clean".
const CLEAN_SKILL: SkillEntry = {
  uri: "skill://data-analysis/SKILL.md",
  frontmatter: {
    name: "data-analysis",
    description: "Analyze a CSV and summarize its columns",
  },
  resources: [
    {
      uri: "skill://data-analysis/SKILL.md",
      digest: SELF_DIGEST,
      size: textToBytes(SELF_TEXT).byteLength,
    },
    {
      uri: "skill://data-analysis/reference.md",
      digest: REF_DIGEST,
      size: textToBytes(REF_TEXT).byteLength,
    },
  ],
};

const TAMPERED_SKILL: SkillEntry = {
  uri: "skill://tampered/SKILL.md",
  frontmatter: { name: "tampered", description: "Bad digest" },
  resources: [
    {
      uri: "skill://tampered/SKILL.md",
      digest: SELF_DIGEST,
      size: textToBytes(SELF_TEXT).byteLength,
    },
    {
      // A well-formed digest of bytes the fake read does not return, and a
      // size that agrees — so the failure reported is a *digest* mismatch and
      // not the cheaper size cross-check.
      uri: "skill://tampered/notes.md",
      digest: `sha256:${"b".repeat(64)}`,
      size: textToBytes(NOTES_TEXT).byteLength,
    },
  ],
};

const DYNAMIC_SKILL: SkillEntry = {
  uri: "skill://dynamic-report/SKILL.md",
  frontmatter: { name: "dynamic-report", description: "Generated files" },
  resources: "dynamic",
};

const MISMATCHED_SKILL: SkillEntry = {
  uri: "skill://wrong-folder/SKILL.md",
  frontmatter: { name: "right-name", description: "Name disagreement" },
  resources: [
    {
      uri: "skill://wrong-folder/SKILL.md",
      digest: SELF_DIGEST,
      size: textToBytes(SELF_TEXT).byteLength,
    },
  ],
};

const ALL_SKILLS = [
  CLEAN_SKILL,
  TAMPERED_SKILL,
  DYNAMIC_SKILL,
  MISMATCHED_SKILL,
];

/** A `resources/read` that serves the fixture bytes for any known URI. */
const readFixtureFile = vi.fn(async (uri: string) => {
  if (uri === "skill://data-analysis/reference.md") return { text: REF_TEXT };
  if (uri === "skill://tampered/notes.md") return { text: NOTES_TEXT };
  return { text: SELF_TEXT, mimeType: "text/markdown" };
});

const baseProps: SkillsScreenProps = {
  skills: ALL_SKILLS,
  pageCount: 2,
  ui: EMPTY_SKILLS_UI,
  onUiChange: vi.fn(),
  onRefreshList: vi.fn(),
  onReadSkillFile: readFixtureFile,
  // Echoes back the very entry `skills/list` advertised, so the default is the
  // agreeing case; tests that care about a disagreement override it.
  onGetSkill: vi.fn(async (uri: string) => {
    const found = ALL_SKILLS.find((skill) => skill.uri === uri);
    if (!found) throw new Error(`Unknown skill uri: ${uri}`);
    return found;
  }),
};

// SkillsScreen is controlled: the selection and the sidebar search live in the
// parent (App) as one `ui` object so they persist across tab navigation
// (#1417). This host holds that state so clicking a skill actually selects it.
function ControlledSkillsScreen(props: Partial<SkillsScreenProps> = {}) {
  const [ui, setUi] = useState<SkillsUiState>({
    ...EMPTY_SKILLS_UI,
    ...props.ui,
  });
  return (
    <SkillsScreen
      {...baseProps}
      {...props}
      ui={ui}
      onUiChange={(next) => {
        setUi(next);
        props.onUiChange?.(next);
      }}
    />
  );
}

describe("SkillsScreen", () => {
  it("renders the empty state until a skill is selected", () => {
    renderWithMantine(<SkillsScreen {...baseProps} />);
    expect(
      screen.getByText("Select a skill to view details"),
    ).toBeInTheDocument();
  });

  it("exposes the readiness contract the headless tab smoke keys off", () => {
    renderWithMantine(<SkillsScreen {...baseProps} />);
    const root = screen.getByTestId("skills-screen");
    expect(root).toHaveAttribute("data-skill-count", "4");
    expect(root).toHaveAttribute("data-skill-page-count", "2");
  });

  it("renders 'No skills' when the list is empty", () => {
    renderWithMantine(<SkillsScreen {...baseProps} skills={[]} />);
    expect(screen.getByText("No skills")).toBeInTheDocument();
  });

  it("renders a load failure above the list", () => {
    renderWithMantine(
      <SkillsScreen {...baseProps} loadError={new Error("nope")} />,
    );
    expect(screen.getByText("Could not load skills")).toBeInTheDocument();
    expect(screen.getByText("nope")).toBeInTheDocument();
  });

  it("filters the sidebar by name and by URI", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ControlledSkillsScreen />);
    await user.type(screen.getByLabelText("Search skills"), "wrong-folder");
    // The matching skill's *name* is `right-name`, so a hit here proves the URI
    // is searched too and not just the display name.
    expect(screen.getByText("right-name")).toBeInTheDocument();
    expect(screen.queryByText("data-analysis")).not.toBeInTheDocument();
  });

  it("calls onRefreshList when Refresh is clicked", async () => {
    const user = userEvent.setup();
    const onRefreshList = vi.fn();
    renderWithMantine(
      <SkillsScreen {...baseProps} onRefreshList={onRefreshList} />,
    );
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefreshList).toHaveBeenCalled();
  });

  it("reports a conforming skill as conforming", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ControlledSkillsScreen />);
    await user.click(screen.getByText("data-analysis"));
    expect(screen.getByText("Conforms")).toBeInTheDocument();
    expect(screen.queryByTestId("skill-issues")).not.toBeInTheDocument();
  });

  it("shows the name/path mismatch as a distinct, named finding", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ControlledSkillsScreen />);
    await user.click(screen.getByText("right-name"));
    const issues = screen.getByTestId("skill-issues");
    expect(within(issues).getByText("name-path-mismatch")).toBeInTheDocument();
  });

  it("shows the dynamic warning and no manifest table", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ControlledSkillsScreen />);
    await user.click(screen.getByText("dynamic-report"));
    expect(screen.getByText("Dynamic resources")).toBeInTheDocument();
    expect(screen.queryByTestId("skill-manifest")).not.toBeInTheDocument();
    // "Verify all" has nothing to verify, so it is disabled rather than a
    // button that silently does nothing.
    expect(screen.getByRole("button", { name: /Verify all/ })).toBeDisabled();
  });

  it("verifies a file whose bytes match its digest", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ControlledSkillsScreen />);
    await user.click(screen.getByText("data-analysis"));
    await user.click(screen.getByRole("button", { name: /Verify all/ }));
    expect(await screen.findAllByText("verified")).toHaveLength(2);
  });

  it("reports a digest mismatch loudly, with both digests", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ControlledSkillsScreen />);
    await user.click(screen.getByText("tampered"));
    await user.click(screen.getByRole("button", { name: /Verify all/ }));
    expect(await screen.findByText("Digest mismatch")).toBeInTheDocument();
    expect(
      screen.getByText(`expected sha256:${"b".repeat(64)}`),
    ).toBeInTheDocument();
  });

  it("verifies a single file from its own row button", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ControlledSkillsScreen />);
    await user.click(screen.getByText("data-analysis"));
    const manifest = screen.getByTestId("skill-manifest");
    // One row at a time: the first row's own Verify button, not "Verify all".
    await user.click(
      within(manifest).getAllByRole("button", { name: "Verify" })[0],
    );
    expect(await screen.findByText("verified")).toBeInTheDocument();
  });

  it("reports a failed read as a read failure, not a mismatch", async () => {
    const user = userEvent.setup();
    const onReadSkillFile = vi.fn().mockRejectedValue(new Error("403"));
    renderWithMantine(
      <ControlledSkillsScreen onReadSkillFile={onReadSkillFile} />,
    );
    await user.click(screen.getByText("data-analysis"));
    await user.click(screen.getByRole("button", { name: /Verify all/ }));
    // One alert per file in the manifest — both reads failed.
    expect(await screen.findAllByText("Could not read file")).toHaveLength(2);
    expect(screen.getAllByText("403")).toHaveLength(2);
  });

  it("wraps a non-Error read rejection", async () => {
    const user = userEvent.setup();
    const onReadSkillFile = vi.fn().mockRejectedValue("plain string");
    renderWithMantine(
      <ControlledSkillsScreen onReadSkillFile={onReadSkillFile} />,
    );
    await user.click(screen.getByText("data-analysis"));
    await user.click(screen.getByRole("button", { name: /Verify all/ }));
    expect(await screen.findAllByText("plain string")).toHaveLength(2);
  });

  it("titles a size disagreement a size mismatch, not a digest one", async () => {
    // `verifySkillResource` catches a size disagreement BEFORE hashing, so
    // there is no `actualDigest` — labelling it "Digest mismatch" would render
    // "actual undefined" and hide the real failure.
    const user = userEvent.setup();
    renderWithMantine(
      <ControlledSkillsScreen
        skills={[
          {
            ...CLEAN_SKILL,
            resources: [{ uri: "skill://data-analysis/SKILL.md", size: 9999 }],
          },
        ]}
      />,
    );
    await user.click(screen.getByText("data-analysis"));
    await user.click(screen.getByRole("button", { name: /Verify all/ }));
    expect(await screen.findByText("Size mismatch")).toBeInTheDocument();
    expect(screen.queryByText("Digest mismatch")).not.toBeInTheDocument();
    // The alert states both lengths; the manifest row also shows the declared
    // one, hence `getAllByText`.
    expect(screen.getAllByText(/9999 bytes/).length).toBeGreaterThan(0);
  });

  it("gives duplicated manifest URIs their own row and their own verdict", async () => {
    // The conformance checker reports `duplicate-resource` rather than
    // collapsing the rows, so the verdicts must not collapse either: the two
    // entries declare different digests and only one of them is right.
    const user = userEvent.setup();
    renderWithMantine(
      <ControlledSkillsScreen
        skills={[
          {
            ...CLEAN_SKILL,
            resources: [
              {
                uri: "skill://data-analysis/SKILL.md",
                digest: SELF_DIGEST,
                size: textToBytes(SELF_TEXT).byteLength,
              },
              {
                uri: "skill://data-analysis/SKILL.md",
                digest: `sha256:${"d".repeat(64)}`,
                size: textToBytes(SELF_TEXT).byteLength,
              },
            ],
          },
        ]}
      />,
    );
    await user.click(screen.getByText("data-analysis"));
    await user.click(screen.getByRole("button", { name: /Verify all/ }));
    // One row verifies and the other does not — a shared key would have made
    // both show whichever landed last.
    expect(await screen.findByText("verified")).toBeInTheDocument();
    expect(screen.getByText("mismatch")).toBeInTheDocument();
  });

  it("renders a base64 SKILL.md preview instead of a blank one", async () => {
    // `onReadSkillFile` supports blob content, and verification reads it
    // correctly; dropping it in the preview would paint an empty box for a
    // file the screen had just checked.
    const user = userEvent.setup();
    const onReadSkillFile = vi.fn().mockResolvedValue({
      blob: btoa("# from a blob\n"),
      mimeType: "text/markdown",
    });
    renderWithMantine(
      <ControlledSkillsScreen onReadSkillFile={onReadSkillFile} />,
    );
    await user.click(screen.getByText("data-analysis"));
    await user.click(screen.getByRole("button", { name: /View SKILL.md/ }));
    const preview = await screen.findByTestId("skill-md-preview");
    expect(preview).toHaveTextContent("from a blob");
  });

  it("keeps the newest verdict when two verifications of one row overlap", async () => {
    // Same row, same manifest — so the manifest key cannot tell these apart.
    // Without a per-row attempt token the older read finishing last would
    // overwrite the newer verdict and leave the UI reporting stale bytes.
    const user = userEvent.setup();
    const resolvers: ((value: { text: string }) => void)[] = [];
    const onReadSkillFile = vi.fn(
      () =>
        new Promise<{ text: string }>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    renderWithMantine(
      <ControlledSkillsScreen
        onReadSkillFile={onReadSkillFile}
        skills={[
          {
            ...CLEAN_SKILL,
            resources: [
              {
                uri: "skill://data-analysis/SKILL.md",
                digest: SELF_DIGEST,
                size: textToBytes(SELF_TEXT).byteLength,
              },
            ],
          },
        ]}
      />,
    );
    await user.click(screen.getByText("data-analysis"));
    const manifest = screen.getByTestId("skill-manifest");
    const rowVerify = within(manifest).getAllByRole("button", {
      name: "Verify",
    })[0];
    await user.click(rowVerify);
    await user.click(rowVerify);
    expect(resolvers).toHaveLength(2);

    // The SECOND read answers first with the matching bytes, then the first
    // read answers with bytes that would verify as a mismatch.
    resolvers[1]({ text: SELF_TEXT });
    expect(await screen.findByText("verified")).toBeInTheDocument();
    resolvers[0]({ text: "stale bytes\n" });
    // Still the newer verdict.
    expect(await screen.findByText("verified")).toBeInTheDocument();
    expect(screen.queryByText("mismatch")).not.toBeInTheDocument();
  });

  it("disables Verify all while a batch is running", async () => {
    // The concurrency cap is per invocation, so a second click would start a
    // second pool of four rather than reusing the first.
    const user = userEvent.setup();
    const pending: ((value: { text: string }) => void)[] = [];
    const onReadSkillFile = vi.fn(
      () =>
        new Promise<{ text: string }>((resolve) => {
          pending.push(resolve);
        }),
    );
    renderWithMantine(
      <ControlledSkillsScreen onReadSkillFile={onReadSkillFile} />,
    );
    await user.click(screen.getByText("data-analysis"));
    const verifyAll = screen.getByRole("button", { name: /Verify all/ });
    await user.click(verifyAll);
    expect(verifyAll).toBeDisabled();
    // Release every read the batch started; the button frees only once the
    // whole batch settles, not once the first file does.
    await waitFor(() => expect(pending.length).toBeGreaterThan(0));
    for (const resolve of pending) resolve({ text: SELF_TEXT });
    await waitFor(() => expect(verifyAll).not.toBeDisabled());
  });

  it("renders every duplicate finding rather than collapsing them", async () => {
    // Three identical URIs produce two `duplicate-resource` findings with the
    // same code and URI. A key built from those alone would make React drop
    // the extras — hiding findings in exactly the malformed input this view is
    // for.
    const user = userEvent.setup();
    const dup = {
      uri: "skill://data-analysis/SKILL.md",
      digest: SELF_DIGEST,
      size: textToBytes(SELF_TEXT).byteLength,
    };
    renderWithMantine(
      <ControlledSkillsScreen
        skills={[{ ...CLEAN_SKILL, resources: [dup, dup, dup] }]}
      />,
    );
    await user.click(screen.getByText("data-analysis"));
    const issues = screen.getByTestId("skill-issues");
    expect(within(issues).getAllByText("duplicate-resource")).toHaveLength(2);
  });

  it("fetches the selected entry through skills/get and reports a match", async () => {
    // The acceptance criterion this exists for: `skills/get` is one of the two
    // methods the extension requires, and a server author's handler is only
    // exercisable if something actually calls it.
    const user = userEvent.setup();
    const onGetSkill = vi.fn().mockResolvedValue(CLEAN_SKILL);
    renderWithMantine(<ControlledSkillsScreen onGetSkill={onGetSkill} />);
    await user.click(screen.getByText("data-analysis"));
    await user.click(
      screen.getByRole("button", { name: /Fetch with skills\/get/ }),
    );
    expect(onGetSkill).toHaveBeenCalledWith(CLEAN_SKILL.uri);
    expect(
      await screen.findByText("skills/get matches skills/list"),
    ).toBeInTheDocument();
  });

  it("treats key and manifest order as immaterial when matching", async () => {
    // The manifest is a set and JSON key order carries no meaning, so a server
    // that enumerates either differently is not inconsistent — a
    // `JSON.stringify` comparison would have called it one.
    const user = userEvent.setup();
    const onGetSkill = vi.fn().mockResolvedValue({
      resources: [...CLEAN_SKILL.resources].reverse(),
      frontmatter: {
        description: CLEAN_SKILL.frontmatter.description,
        name: CLEAN_SKILL.frontmatter.name,
      },
      uri: CLEAN_SKILL.uri,
    });
    renderWithMantine(<ControlledSkillsScreen onGetSkill={onGetSkill} />);
    await user.click(screen.getByText("data-analysis"));
    await user.click(
      screen.getByRole("button", { name: /Fetch with skills\/get/ }),
    );
    expect(
      await screen.findByText("skills/get matches skills/list"),
    ).toBeInTheDocument();
  });

  it("reports a skills/get entry that differs from the listing", async () => {
    // Shown, but not called an error: `skills/get` is a fresh snapshot, so a
    // skill that genuinely changed since the listing legitimately differs.
    const user = userEvent.setup();
    const onGetSkill = vi.fn().mockResolvedValue({
      ...CLEAN_SKILL,
      frontmatter: { ...CLEAN_SKILL.frontmatter, description: "different" },
    });
    renderWithMantine(<ControlledSkillsScreen onGetSkill={onGetSkill} />);
    await user.click(screen.getByText("data-analysis"));
    await user.click(
      screen.getByRole("button", { name: /Fetch with skills\/get/ }),
    );
    expect(
      await screen.findByText("skills/get returned a different snapshot"),
    ).toBeInTheDocument();
    // The fetched entry is rendered beside the verdict so the difference is
    // inspectable rather than merely asserted. (Its JSON goes through
    // `ContentViewer`'s highlighter, which splits tokens across elements, so
    // the presence of the block is what is pinned here — the copy above is
    // what states the finding.)
    expect(screen.getByTestId("skills-get-result")).toBeInTheDocument();
  });

  it("calls a non-conforming skills/get entry invalid, not a new snapshot", async () => {
    // A fresh snapshot excuses a CHANGE; it does not excuse a violation. An
    // entry missing a digest is invalid whether or not the skill moved on.
    const user = userEvent.setup();
    const onGetSkill = vi.fn().mockResolvedValue({
      ...CLEAN_SKILL,
      resources: [{ uri: "skill://data-analysis/SKILL.md" }],
    });
    renderWithMantine(<ControlledSkillsScreen onGetSkill={onGetSkill} />);
    await user.click(screen.getByText("data-analysis"));
    await user.click(
      screen.getByRole("button", { name: /Fetch with skills\/get/ }),
    );
    const result = await screen.findByTestId("skills-get-result");
    expect(result).toHaveAttribute("data-verdict", "invalid");
    expect(result).toHaveTextContent("missing-digest");
  });

  it("calls a skills/get answer for a different uri invalid", async () => {
    // Answering with another skill is never a valid refresh of the one asked
    // for, however much that other skill may have changed.
    const user = userEvent.setup();
    const onGetSkill = vi.fn().mockResolvedValue(TAMPERED_SKILL);
    renderWithMantine(<ControlledSkillsScreen onGetSkill={onGetSkill} />);
    await user.click(screen.getByText("data-analysis"));
    await user.click(
      screen.getByRole("button", { name: /Fetch with skills\/get/ }),
    );
    const result = await screen.findByTestId("skills-get-result");
    expect(result).toHaveAttribute("data-verdict", "invalid");
    expect(result).toHaveTextContent("different URI");
  });

  it("reports a failed skills/get", async () => {
    const user = userEvent.setup();
    const onGetSkill = vi.fn().mockRejectedValue(new Error("-32602"));
    renderWithMantine(<ControlledSkillsScreen onGetSkill={onGetSkill} />);
    await user.click(screen.getByText("data-analysis"));
    await user.click(
      screen.getByRole("button", { name: /Fetch with skills\/get/ }),
    );
    expect(await screen.findByText("skills/get failed")).toBeInTheDocument();
    expect(screen.getByText("-32602")).toBeInTheDocument();
  });

  it("discards a skills/get that resolves after the selection moved on", async () => {
    const user = userEvent.setup();
    let release: ((value: SkillEntry) => void) | undefined;
    const onGetSkill = vi.fn(
      () =>
        new Promise<SkillEntry>((resolve) => {
          release = resolve;
        }),
    );
    renderWithMantine(<ControlledSkillsScreen onGetSkill={onGetSkill} />);
    await user.click(screen.getByText("data-analysis"));
    await user.click(
      screen.getByRole("button", { name: /Fetch with skills\/get/ }),
    );
    await user.click(screen.getByText("tampered"));
    release?.(CLEAN_SKILL);
    expect(screen.queryByTestId("skills-get-result")).not.toBeInTheDocument();
  });

  it("frees Verify all for a newly selected skill while the old batch is hung", async () => {
    // A global flag would leave the new skill's button disabled until the
    // previous skill's reads settled — forever, if one of them hangs.
    const user = userEvent.setup();
    const onReadSkillFile = vi.fn(
      () => new Promise<{ text: string }>(() => {}),
    );
    renderWithMantine(
      <ControlledSkillsScreen onReadSkillFile={onReadSkillFile} />,
    );
    await user.click(screen.getByText("data-analysis"));
    await user.click(screen.getByRole("button", { name: /Verify all/ }));
    expect(screen.getByRole("button", { name: /Verify all/ })).toBeDisabled();
    await user.click(screen.getByText("tampered"));
    expect(
      screen.getByRole("button", { name: /Verify all/ }),
    ).not.toBeDisabled();
  });

  it("keeps the newest SKILL.md preview when two reads overlap", async () => {
    // Same skill, same manifest — the key cannot order these, so without an
    // attempt token the older read finishing last would replace the newer
    // preview with stale content.
    const user = userEvent.setup();
    const resolvers: ((value: { text: string }) => void)[] = [];
    const onReadSkillFile = vi.fn(
      () =>
        new Promise<{ text: string }>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    renderWithMantine(
      <ControlledSkillsScreen onReadSkillFile={onReadSkillFile} />,
    );
    await user.click(screen.getByText("data-analysis"));
    const view = screen.getByRole("button", { name: /View SKILL.md/ });
    await user.click(view);
    await user.click(view);
    expect(resolvers).toHaveLength(2);

    resolvers[1]({ text: "# newest\n" });
    expect(await screen.findByTestId("skill-md-preview")).toHaveTextContent(
      "newest",
    );
    resolvers[0]({ text: "# stale\n" });
    expect(screen.getByTestId("skill-md-preview")).not.toHaveTextContent(
      "stale",
    );
  });

  it("keeps the newest skills/get result when two fetches overlap", async () => {
    const user = userEvent.setup();
    const resolvers: ((value: SkillEntry) => void)[] = [];
    const onGetSkill = vi.fn(
      () =>
        new Promise<SkillEntry>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    renderWithMantine(<ControlledSkillsScreen onGetSkill={onGetSkill} />);
    await user.click(screen.getByText("data-analysis"));
    const fetchButton = screen.getByRole("button", {
      name: /Fetch with skills\/get/,
    });
    await user.click(fetchButton);
    await user.click(fetchButton);
    expect(resolvers).toHaveLength(2);

    // The newer fetch matches; the older one, landing last, would otherwise
    // overwrite it with a "different snapshot" verdict.
    resolvers[1](CLEAN_SKILL);
    expect(
      await screen.findByText("skills/get matches skills/list"),
    ).toBeInTheDocument();
    resolvers[0]({
      ...CLEAN_SKILL,
      frontmatter: { ...CLEAN_SKILL.frontmatter, description: "stale" },
    });
    expect(
      screen.getByText("skills/get matches skills/list"),
    ).toBeInTheDocument();
  });

  it("drops the skills/get verdict when a refresh changes only metadata", async () => {
    // The manifest is untouched, so a manifest-only invalidation key would
    // leave "matches" on screen even though it was computed against the
    // previous entry — and that comparison covers `frontmatter` too.
    const user = userEvent.setup();
    const onGetSkill = vi.fn().mockResolvedValue(CLEAN_SKILL);
    const { rerender } = renderWithMantine(
      <SkillsScreen
        {...baseProps}
        skills={[CLEAN_SKILL]}
        onGetSkill={onGetSkill}
        ui={{ ...EMPTY_SKILLS_UI, selectedSkillUri: CLEAN_SKILL.uri }}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: /Fetch with skills\/get/ }),
    );
    expect(
      await screen.findByText("skills/get matches skills/list"),
    ).toBeInTheDocument();

    rerender(
      <SkillsScreen
        {...baseProps}
        skills={[
          {
            ...CLEAN_SKILL,
            frontmatter: {
              ...CLEAN_SKILL.frontmatter,
              description: "reworded since the fetch",
            },
          },
        ]}
        onGetSkill={onGetSkill}
        ui={{ ...EMPTY_SKILLS_UI, selectedSkillUri: CLEAN_SKILL.uri }}
      />,
    );
    expect(screen.queryByTestId("skills-get-result")).not.toBeInTheDocument();
  });

  it("keeps Verify all disabled per skill while batches on other skills run", async () => {
    // A → *start B's batch too* → back to A. That middle step is the one that
    // matters: with a single slot instead of a map, starting B's batch
    // overwrote A's, so A's button read as free and a second pool of workers
    // could be started on top of A's first — doubling the concurrency cap the
    // button exists to hold.
    const user = userEvent.setup();
    const onReadSkillFile = vi.fn(
      () => new Promise<{ text: string }>(() => {}),
    );
    renderWithMantine(
      <ControlledSkillsScreen onReadSkillFile={onReadSkillFile} />,
    );
    const verifyAll = () => screen.getByRole("button", { name: /Verify all/ });

    await user.click(screen.getByText("data-analysis"));
    await user.click(verifyAll());
    expect(verifyAll()).toBeDisabled();

    // B is free to run its own batch, and does.
    await user.click(screen.getByText("tampered"));
    expect(verifyAll()).not.toBeDisabled();
    await user.click(verifyAll());
    expect(verifyAll()).toBeDisabled();

    // Returning to A still finds A's own batch in flight.
    await user.click(screen.getByText("data-analysis"));
    expect(verifyAll()).toBeDisabled();
  });

  it("shows the SKILL.md preview on demand", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ControlledSkillsScreen />);
    await user.click(screen.getByText("data-analysis"));
    await user.click(screen.getByRole("button", { name: /View SKILL.md/ }));
    expect(await screen.findByTestId("skill-md-preview")).toBeInTheDocument();
  });

  it("reports a failed SKILL.md read", async () => {
    const user = userEvent.setup();
    const onReadSkillFile = vi.fn().mockRejectedValue(new Error("gone"));
    renderWithMantine(
      <ControlledSkillsScreen onReadSkillFile={onReadSkillFile} />,
    );
    await user.click(screen.getByText("data-analysis"));
    await user.click(screen.getByRole("button", { name: /View SKILL.md/ }));
    expect(
      await screen.findByText("Could not read SKILL.md"),
    ).toBeInTheDocument();
  });

  it("wraps a non-Error SKILL.md rejection", async () => {
    const user = userEvent.setup();
    const onReadSkillFile = vi.fn().mockRejectedValue("bare");
    renderWithMantine(
      <ControlledSkillsScreen onReadSkillFile={onReadSkillFile} />,
    );
    await user.click(screen.getByText("data-analysis"));
    await user.click(screen.getByRole("button", { name: /View SKILL.md/ }));
    expect(await screen.findByText("bare")).toBeInTheDocument();
  });

  it("drops verification results when the selection changes", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ControlledSkillsScreen />);
    await user.click(screen.getByText("data-analysis"));
    await user.click(screen.getByRole("button", { name: /Verify all/ }));
    expect(await screen.findAllByText("verified")).toHaveLength(2);

    // A verdict belongs to the skill it was computed for; carrying it across a
    // selection change would attribute one skill's result to another.
    await user.click(screen.getByText("tampered"));
    expect(screen.queryByText("verified")).not.toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("drops the SKILL.md preview when the selection changes", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ControlledSkillsScreen />);
    await user.click(screen.getByText("data-analysis"));
    await user.click(screen.getByRole("button", { name: /View SKILL.md/ }));
    expect(await screen.findByTestId("skill-md-preview")).toBeInTheDocument();
    await user.click(screen.getByText("tampered"));
    expect(screen.queryByTestId("skill-md-preview")).not.toBeInTheDocument();
  });

  it("renders an em dash for a manifest entry with no size or digest", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ControlledSkillsScreen
        skills={[
          {
            ...CLEAN_SKILL,
            resources: [{ uri: "skill://data-analysis/SKILL.md" }],
          },
        ]}
      />,
    );
    await user.click(screen.getByText("data-analysis"));
    const manifest = screen.getByTestId("skill-manifest");
    // Three em dashes in the single row: the size cell, the digest cell, and
    // the not-yet-run verification badge — which stays distinct from
    // "unverifiable" so an absent digest is never mistaken for an unrun check.
    expect(within(manifest).getAllByText("—")).toHaveLength(3);
  });

  it("truncates a long digest but shows a short one whole", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ControlledSkillsScreen
        skills={[
          {
            ...CLEAN_SKILL,
            resources: [
              { uri: "skill://data-analysis/SKILL.md", digest: "sha256:short" },
            ],
          },
        ]}
      />,
    );
    await user.click(screen.getByText("data-analysis"));
    expect(screen.getByText("sha256:short")).toBeInTheDocument();
  });

  it("reports a file with no advertised digest as unverifiable, not verified", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ControlledSkillsScreen
        skills={[
          {
            ...CLEAN_SKILL,
            resources: [{ uri: "skill://data-analysis/SKILL.md" }],
          },
        ]}
      />,
    );
    await user.click(screen.getByText("data-analysis"));
    await user.click(screen.getByRole("button", { name: /Verify all/ }));
    expect(await screen.findByText("unverifiable")).toBeInTheDocument();
  });

  it("drops verdicts when a refresh replaces the manifest for the same skill", async () => {
    // The selection never changes, so keying invalidation on the URI alone
    // would leave a green `verified` badge attached to a digest the refresh
    // replaced — the UI vouching for content it has never checked.
    const user = userEvent.setup();
    const { rerender } = renderWithMantine(
      <SkillsScreen
        {...baseProps}
        skills={[CLEAN_SKILL]}
        ui={{ ...EMPTY_SKILLS_UI, selectedSkillUri: CLEAN_SKILL.uri }}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Verify all/ }));
    expect(await screen.findAllByText("verified")).toHaveLength(2);

    rerender(
      <SkillsScreen
        {...baseProps}
        skills={[
          {
            ...CLEAN_SKILL,
            resources: [
              {
                uri: "skill://data-analysis/SKILL.md",
                digest: `sha256:${"c".repeat(64)}`,
                size: 1,
              },
            ],
          },
        ]}
        ui={{ ...EMPTY_SKILLS_UI, selectedSkillUri: CLEAN_SKILL.uri }}
      />,
    );
    expect(screen.queryByText("verified")).not.toBeInTheDocument();
  });

  it("discards a verification that resolves after the selection moved on", async () => {
    // A read still in flight when the user switches skills must not write its
    // verdict into the newly selected skill's rows.
    const user = userEvent.setup();
    let release: ((value: { text: string }) => void) | undefined;
    const onReadSkillFile = vi.fn(
      () =>
        new Promise<{ text: string }>((resolve) => {
          release = resolve;
        }),
    );
    renderWithMantine(
      <ControlledSkillsScreen onReadSkillFile={onReadSkillFile} />,
    );
    await user.click(screen.getByText("data-analysis"));
    await user.click(screen.getByRole("button", { name: /Verify all/ }));
    await user.click(screen.getByText("tampered"));
    release?.({ text: SELF_TEXT });
    // Nothing from the abandoned read reaches the new selection's rows.
    expect(screen.queryByText("verified")).not.toBeInTheDocument();
    expect(screen.queryByText("mismatch")).not.toBeInTheDocument();
  });

  it("discards a SKILL.md read that resolves after the selection moved on", async () => {
    const user = userEvent.setup();
    let release: ((value: { text: string }) => void) | undefined;
    const onReadSkillFile = vi.fn(
      () =>
        new Promise<{ text: string }>((resolve) => {
          release = resolve;
        }),
    );
    renderWithMantine(
      <ControlledSkillsScreen onReadSkillFile={onReadSkillFile} />,
    );
    await user.click(screen.getByText("data-analysis"));
    await user.click(screen.getByRole("button", { name: /View SKILL.md/ }));
    await user.click(screen.getByText("tampered"));
    release?.({ text: SELF_TEXT });
    expect(screen.queryByTestId("skill-md-preview")).not.toBeInTheDocument();
  });

  it("discards a failed SKILL.md read that resolves after the selection moved on", async () => {
    const user = userEvent.setup();
    let fail: ((err: Error) => void) | undefined;
    const onReadSkillFile = vi.fn(
      () =>
        new Promise<{ text: string }>((_resolve, reject) => {
          fail = reject;
        }),
    );
    renderWithMantine(
      <ControlledSkillsScreen onReadSkillFile={onReadSkillFile} />,
    );
    await user.click(screen.getByText("data-analysis"));
    await user.click(screen.getByRole("button", { name: /View SKILL.md/ }));
    await user.click(screen.getByText("tampered"));
    fail?.(new Error("too late"));
    expect(screen.queryByText("too late")).not.toBeInTheDocument();
  });
});
