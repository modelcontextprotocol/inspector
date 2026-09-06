import { StrictMode, useState } from "react";
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
// A real SKILL.md carries frontmatter, and the screen now splits it out of the
// served bytes (#2263) — so the fixture has to have some, or the Frontmatter
// section it drives would never render here.
const SELF_TEXT = "---\nname: data-analysis\n---\n\n# data-analysis\n";
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
  sessionKey: "session-1",
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

// Mantine puts a Badge's colour on the ROOT as CSS custom properties, while
// `getByText` matches the inner label span — so the colour has to be read from
// the enclosing root rather than from the matched node.
function badgeStyle(text: RegExp): string {
  const root = screen.getByText(text).closest(".mantine-Badge-root");
  return root?.getAttribute("style") ?? "";
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

  it("says the list was empty without claiming there are no skills", () => {
    // SEP-2640 lets a server return an empty or partial catalog and says an
    // empty result is not proof it has none — an unlisted skill is still
    // fetchable by URI — so "No skills" would be the tool asserting something
    // the protocol explicitly does not.
    renderWithMantine(<SkillsScreen {...baseProps} skills={[]} />);
    expect(screen.getByText("No skills listed")).toBeInTheDocument();
    expect(screen.queryByText("No skills")).not.toBeInTheDocument();
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

  it("collapses Conformance for a clean entry, and still reports it on expand", async () => {
    // A clean entry opens collapsed (#2263): the header badge already says
    // "0 error(s), 0 warning(s)", so an expanded "Conforms" panel is only
    // taking space the file viewer could use. The verdict is still there.
    const user = userEvent.setup();
    renderWithMantine(<ControlledSkillsScreen />);
    await user.click(screen.getByText("data-analysis"));
    const control = screen.getByRole("button", { name: /Conformance/ });
    expect(control).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("No structural issues")).not.toBeInTheDocument();

    await user.click(control);
    expect(screen.getByText("No structural issues")).toBeInTheDocument();
    expect(screen.queryByTestId("skill-issues")).not.toBeInTheDocument();
  });

  it("collapses Conformance for a clean skill selected BEFORE mount", () => {
    // `useValueChange` deliberately does not fire on the first render, so the
    // auto-collapse it drives cannot cover a screen that mounts with a skill
    // already chosen — a restored `SkillsUiState` does exactly that. The
    // initialiser has to apply the same rule, or the behaviour only starts
    // working after some later selection change (#2263).
    renderWithMantine(
      <SkillsScreen
        {...baseProps}
        ui={{ ...EMPTY_SKILLS_UI, selectedSkillUri: CLEAN_SKILL.uri }}
      />,
    );
    expect(screen.getByRole("button", { name: /Conformance/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("opens Conformance for a skill WITH findings selected before mount", () => {
    renderWithMantine(
      <SkillsScreen
        {...baseProps}
        ui={{ ...EMPTY_SKILLS_UI, selectedSkillUri: MISMATCHED_SKILL.uri }}
      />,
    );
    expect(screen.getByRole("button", { name: /Conformance/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("opens Conformance for an entry that has findings", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ControlledSkillsScreen />);
    await user.click(screen.getByText("right-name"));
    expect(screen.getByRole("button", { name: /Conformance/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByTestId("skill-issues")).toBeInTheDocument();
  });

  it("re-opens Conformance when switching from a clean entry to a broken one", async () => {
    // The section tracks the signal rather than latching: a user who lands on a
    // clean skill and then picks a broken one must not have the findings hidden
    // behind a click.
    const user = userEvent.setup();
    renderWithMantine(<ControlledSkillsScreen />);
    await user.click(screen.getByText("data-analysis"));
    expect(screen.getByRole("button", { name: /Conformance/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await user.click(screen.getByText("right-name"));
    expect(screen.getByRole("button", { name: /Conformance/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("reports a digest mismatch in Conformance, with its own red badge", async () => {
    // `tampered-notes` is structurally clean but serves bytes that do not match
    // its manifest, so its Conformance section starts collapsed — pressing
    // Verify has to open it, or the verdict lands where nobody can see it
    // (#2263). The mismatch count is a separate badge because it is a RUNTIME
    // result: folding it into "N error(s)" would make that number change
    // meaning after a click.
    const user = userEvent.setup();
    renderWithMantine(<ControlledSkillsScreen />);
    await user.click(screen.getByText("tampered"));
    expect(screen.getByRole("button", { name: /Conformance/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByText(/mismatch\(es\)/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Verify all/ }));
    expect(await screen.findByText("Digest mismatch")).toBeInTheDocument();

    const conformance = screen.getByRole("button", { name: /Conformance/ });
    expect(conformance).toHaveAttribute("aria-expanded", "true");
    // The alert renders inside Conformance, not beside the manifest table.
    expect(conformance.closest(".mantine-Accordion-item")).toContainElement(
      screen.getByText("Digest mismatch"),
    );
    expect(badgeStyle(/1 mismatch\(es\)/)).toContain("red");
  });

  it("a stale Verify all batch does not reopen Conformance on another skill", async () => {
    // `verifyRow` is called once per row by every "Verify all" worker as it
    // advances, so a batch begun on one skill keeps calling it after the user
    // has moved on. The keyed writes discard those results, but an open-state
    // update is not keyed to a manifest — so opening the section from inside
    // `verifyRow` let obsolete work mutate the current pane (#2263).
    const user = userEvent.setup();
    // Held open so the batch is still in flight when the selection changes.
    const releases: (() => void)[] = [];
    const onReadSkillFile = vi.fn(
      () =>
        new Promise<{ text: string }>((resolve) => {
          releases.push(() => resolve({ text: SELF_TEXT }));
        }),
    );
    // More rows than the concurrency cap, so workers keep pulling.
    const manyRows: SkillEntry = {
      ...CLEAN_SKILL,
      uri: "skill://many/SKILL.md",
      frontmatter: { name: "many", description: "Many rows" },
      resources: Array.from({ length: 10 }, (_, i) => ({
        uri: i === 0 ? "skill://many/SKILL.md" : `skill://many/f${i}.md`,
        digest: SELF_DIGEST,
        size: textToBytes(SELF_TEXT).byteLength,
      })),
    };
    renderWithMantine(
      <ControlledSkillsScreen
        skills={[manyRows, CLEAN_SKILL]}
        onReadSkillFile={onReadSkillFile}
      />,
    );
    await user.click(screen.getByText("many"));
    await user.click(screen.getByRole("button", { name: /Verify all/ }));

    // Switch to a clean skill and collapse Conformance deliberately.
    await user.click(
      within(screen.getByTestId("skills-screen")).getAllByText(
        "data-analysis",
      )[0],
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Conformance/ }),
      ).toHaveAttribute("aria-expanded", "false"),
    );

    // Let the abandoned batch's workers advance. They must not reopen it.
    for (const release of releases) release();
    await waitFor(() => expect(onReadSkillFile).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /Conformance/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("bounds every server-controlled string in the fixed header", async () => {
    // The header sits beside an accordion whose flex-basis is 0, so anything
    // unbounded here is subtracted from the sections rather than resisted by
    // them. This has been the same bug three times over (#2263) — the viewer's
    // content-sized basis, the `skills/get` region, the description — so this
    // asserts the *class* is closed rather than chasing one more instance.
    const user = userEvent.setup();
    const hostile: SkillEntry = {
      uri: `skill://${"very-long-segment/".repeat(40)}SKILL.md`,
      frontmatter: {
        name: "x".repeat(300),
        // SEP-2640 permits 1,024 characters here.
        description: "word ".repeat(400).trim(),
      },
      resources: [
        {
          uri: `skill://${"very-long-segment/".repeat(40)}SKILL.md`,
          digest: SELF_DIGEST,
          size: textToBytes(SELF_TEXT).byteLength,
        },
      ],
    };
    renderWithMantine(<ControlledSkillsScreen skills={[hostile]} />);
    await user.click(screen.getAllByText("x".repeat(300))[0]);

    // The *geometric* bound is a CSS concern and belongs in a real browser —
    // `HostileHeader` in the stories asserts the header cannot starve the
    // accordion. What is worth pinning here is the contract that makes
    // clamping safe: the full value stays reachable on a `title`, so nothing
    // is actually hidden from the user.
    // Two captions legitimately carry it: the header's URI and the Skill
    // Resource control's file name, which for the skill's own SKILL.md is the
    // same URI.
    expect(screen.getAllByTitle(hostile.uri).length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByTitle(hostile.frontmatter.description as string),
    ).toBeInTheDocument();
    // And the header still shows all three, rather than dropping any.
    const detail = screen.getByTestId("skill-detail");
    expect(detail.textContent).toContain("xxxx");
    expect(detail.textContent).toContain("skill://very-long-segment");
    expect(detail.textContent).toContain("word word");
  });

  it("badges a warning-only entry yellow, not green", async () => {
    // Green reads as "nothing to see", which would hide the only signal the
    // section carries for an entry whose findings are all warnings (#2263).
    const user = userEvent.setup();
    renderWithMantine(<ControlledSkillsScreen />);
    await user.click(screen.getByText("dynamic-report"));
    // `dynamic-resources` is a warning, and the only finding on this fixture.
    const style = badgeStyle(/0 error\(s\), 1 warning\(s\)/);
    expect(style).toContain("yellow");
    expect(style).not.toContain("green");
  });

  it("badges a clean entry green and a broken one red", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ControlledSkillsScreen />);
    await user.click(screen.getByText("data-analysis"));
    expect(badgeStyle(/0 error\(s\), 0 warning\(s\)/)).toContain("green");

    await user.click(screen.getByText("right-name"));
    expect(badgeStyle(/1 error\(s\), 0 warning\(s\)/)).toContain("red");
  });

  it("shows the name/path mismatch as a distinct, named finding", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ControlledSkillsScreen />);
    await user.click(screen.getByText("right-name"));
    const issues = screen.getByTestId("skill-issues");
    expect(within(issues).getByText("name-path-mismatch")).toBeInTheDocument();
  });

  it("states the dynamic case once, in Conformance, with no Resources section", async () => {
    // A dynamic skill has no manifest, so an empty Resources section whose only
    // content explains its own emptiness is redundant with the conformance
    // finding — the fact is stated once, in prose, in Conformance (#2263).
    const user = userEvent.setup();
    renderWithMantine(<ControlledSkillsScreen />);
    await user.click(screen.getByText("dynamic-report"));

    const conformance = screen.getByRole("button", { name: /Conformance/ });
    expect(conformance.closest(".mantine-Accordion-item")).toContainElement(
      screen.getByText("Dynamic resources"),
    );
    // The section, its header and its table are all gone — not merely empty.
    expect(
      screen.queryByRole("button", { name: /Resources/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("skill-manifest")).not.toBeInTheDocument();
    // And the terse finding is not repeated beside the prose banner.
    expect(screen.queryByText("dynamic-resources")).not.toBeInTheDocument();
    // It still counts toward the warning total, because it is still a finding.
    expect(
      screen.getByText(/0 error\(s\), 1 warning\(s\)/),
    ).toBeInTheDocument();

    // "Verify all" has nothing to verify, so it is disabled rather than a
    // button that silently does nothing.
    expect(screen.getByRole("button", { name: /Verify all/ })).toBeDisabled();
  });

  it("expand-all stays satisfiable for a dynamic skill", async () => {
    // The toggle compares against the sections that actually render; leaving
    // `resources` in that list would make "expand all" unreachable here.
    const user = userEvent.setup();
    renderWithMantine(<ControlledSkillsScreen />);
    await user.click(screen.getByText("dynamic-report"));
    await user.click(screen.getByRole("button", { name: "Collapse all" }));
    await user.click(screen.getByRole("button", { name: "Expand all" }));
    expect(
      screen.getByRole("button", { name: "Collapse all" }),
    ).toBeInTheDocument();
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
    // Addressed by its accessible name, which carries the URI — every row's
    // visible text is just "Verify", so that name is what tells a
    // screen-reader user (and this test) which file the button checks.
    await user.click(
      screen.getByRole("button", {
        name: "Verify skill://data-analysis/reference.md",
      }),
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
    // Three, not two: the same rejecting read also serves the SKILL.md the
    // viewer loads on selection (#2263), so the message appears once per
    // manifest row plus once in the viewer.
    expect(screen.getAllByText("403")).toHaveLength(3);
  });

  it("wraps a non-Error read rejection", async () => {
    const user = userEvent.setup();
    const onReadSkillFile = vi.fn().mockRejectedValue("plain string");
    renderWithMantine(
      <ControlledSkillsScreen onReadSkillFile={onReadSkillFile} />,
    );
    await user.click(screen.getByText("data-analysis"));
    await user.click(screen.getByRole("button", { name: /Verify all/ }));
    // Three: one per manifest row, plus the viewer's own auto-loaded SKILL.md
    // read, which the same mock rejects (#2263).
    expect(await screen.findAllByText("plain string")).toHaveLength(3);
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
    // correctly; dropping it in the viewer would paint an empty box for a
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
    const viewer = screen.getByTestId("skill-resource-viewer");
    await waitFor(() => expect(viewer).toHaveTextContent("from a blob"));
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
    // Selecting the skill already issued the viewer's own SKILL.md read
    // (#2263), so the two clicks below are the reads AFTER that one.
    const base = resolvers.length;
    const rowVerify = screen.getByRole("button", {
      name: "Verify skill://data-analysis/SKILL.md",
    });
    await user.click(rowVerify);
    await user.click(rowVerify);
    expect(resolvers).toHaveLength(base + 2);

    // The SECOND read answers first with the matching bytes, then the first
    // read answers with bytes that would verify as a mismatch.
    resolvers[base + 1]({ text: SELF_TEXT });
    expect(await screen.findByText("verified")).toBeInTheDocument();
    resolvers[base]({ text: "stale bytes\n" });
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
    // The verdict is a conformance statement, so it renders inside the
    // Conformance section (#2263) — and that section auto-collapses for a clean
    // entry, so the fetch has to open it or the answer would be invisible.
    const conformance = screen.getByRole("button", { name: /Conformance/ });
    expect(conformance).toHaveAttribute("aria-expanded", "true");
    expect(conformance.closest(".mantine-Accordion-item")).toContainElement(
      screen.getByTestId("skills-get-result"),
    );
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
    // Past the viewer's own read for the selection (#2263).
    const base = resolvers.length;
    const view = screen.getByRole("button", {
      name: "skill://data-analysis/reference.md",
    });
    await user.click(view);
    await user.click(view);
    expect(resolvers).toHaveLength(base + 2);

    const viewer = screen.getByTestId("skill-resource-viewer");
    resolvers[base + 1]({ text: "# newest\n" });
    await waitFor(() => expect(viewer).toHaveTextContent("newest"));
    resolvers[base]({ text: "# stale\n" });
    expect(viewer).not.toHaveTextContent("stale");
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

  it("discards a verification that lands after the session changed", async () => {
    // This screen stays mounted across a disconnect, so content alone does not
    // tell server A's entry from an identical-looking one on server B. Without
    // the session in the key, A's in-flight read would land and report
    // `verified` for a file that was never read from B.
    const user = userEvent.setup();
    let release: ((value: { text: string }) => void) | undefined;
    const onReadSkillFile = vi.fn(
      () =>
        new Promise<{ text: string }>((resolve) => {
          release = resolve;
        }),
    );
    const { rerender } = renderWithMantine(
      <SkillsScreen
        {...baseProps}
        sessionKey="server-a:1"
        onReadSkillFile={onReadSkillFile}
        skills={[CLEAN_SKILL]}
        ui={{ ...EMPTY_SKILLS_UI, selectedSkillUri: CLEAN_SKILL.uri }}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Verify all/ }));

    // Same entry, different session.
    rerender(
      <SkillsScreen
        {...baseProps}
        sessionKey="server-b:2"
        onReadSkillFile={onReadSkillFile}
        skills={[CLEAN_SKILL]}
        ui={{ ...EMPTY_SKILLS_UI, selectedSkillUri: CLEAN_SKILL.uri }}
      />,
    );
    release?.({ text: SELF_TEXT });
    expect(screen.queryByText("verified")).not.toBeInTheDocument();
    // ...and the batch guard did not carry over either.
    expect(
      screen.getByRole("button", { name: /Verify all/ }),
    ).not.toBeDisabled();
  });

  it("keeps the selection when a refresh canonicalizes the skill's URI", async () => {
    // The selection is stored as the URI the list gave us, so a server that
    // re-spells it must not empty the detail pane for the same skill.
    renderWithMantine(
      <SkillsScreen
        {...baseProps}
        skills={[CLEAN_SKILL]}
        ui={{
          ...EMPTY_SKILLS_UI,
          selectedSkillUri: "skill://data-analysis/%53KILL.md",
        }}
      />,
    );
    expect(screen.getByTestId("skill-detail")).toBeInTheDocument();
    expect(
      screen.queryByText("Select a skill to view details"),
    ).not.toBeInTheDocument();
  });

  it("rejects an older preview read even when it resolves FIRST", async () => {
    // The ordering hole: recording an attempt only when it settles leaves a
    // window where the older request is still considered current. Claiming it
    // before the request goes out is what makes the older callback stale
    // immediately, whatever order the two resolve in.
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
    // Past the viewer's own read for the selection (#2263).
    const base = resolvers.length;
    const view = screen.getByRole("button", {
      name: "skill://data-analysis/reference.md",
    });
    await user.click(view);
    await user.click(view);
    expect(resolvers).toHaveLength(base + 2);

    const viewer = screen.getByTestId("skill-resource-viewer");
    // The OLDER read answers first, while the newer one is still in flight.
    resolvers[base]({ text: "# stale\n" });
    expect(viewer).not.toHaveTextContent("stale");
    resolvers[base + 1]({ text: "# newest\n" });
    await waitFor(() => expect(viewer).toHaveTextContent("newest"));
  });

  it("rejects an older skills/get even when it resolves FIRST", async () => {
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

    // The older fetch answers first with a differing entry; it must not
    // publish a verdict while the newer one is pending.
    resolvers[0]({
      ...CLEAN_SKILL,
      frontmatter: { ...CLEAN_SKILL.frontmatter, description: "stale" },
    });
    expect(screen.queryByTestId("skills-get-result")).not.toBeInTheDocument();
    resolvers[1](CLEAN_SKILL);
    expect(
      await screen.findByText("skills/get matches skills/list"),
    ).toBeInTheDocument();
  });

  it("shows the skill's own SKILL.md as soon as it is selected", async () => {
    // No button to press (#2263): the viewer opens on the skill's own file, so
    // selecting it is the whole interaction.
    const user = userEvent.setup();
    renderWithMantine(<ControlledSkillsScreen />);
    await user.click(screen.getByText("data-analysis"));
    const viewer = screen.getByTestId("skill-resource-viewer");
    await waitFor(() => expect(viewer).toHaveTextContent("data-analysis"));
    expect(
      screen.queryByRole("button", { name: /View SKILL.md/ }),
    ).not.toBeInTheDocument();
  });

  it("heads the viewer with the displayed file, not the section's purpose", async () => {
    // The heading is static so it does not change shape as the file changes;
    // the file name sits beside it (#2263).
    const user = userEvent.setup();
    renderWithMantine(<ControlledSkillsScreen />);
    await user.click(screen.getByText("data-analysis"));
    // The heading lives on the section's control (it is the collapsible
    // section's own header), so it is queried at screen level rather than
    // inside the panel.
    const control = within(
      screen.getByRole("button", { name: /Skill Resource/ }),
    );
    expect(control.getByText("Skill Resource")).toBeInTheDocument();
    expect(control.getByText("SKILL.md")).toBeInTheDocument();
  });

  it("swaps the displayed file when a manifest URI is clicked", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ControlledSkillsScreen />);
    await user.click(screen.getByText("data-analysis"));
    const viewer = screen.getByTestId("skill-resource-viewer");
    await waitFor(() => expect(viewer).toHaveTextContent("data-analysis"));

    await user.click(
      screen.getByRole("button", {
        name: "skill://data-analysis/reference.md",
      }),
    );
    await waitFor(() => expect(viewer).toHaveTextContent("Column rules"));
    // The section header follows the file, and the previous contents are gone.
    expect(
      within(screen.getByRole("button", { name: /Skill Resource/ })).getByText(
        "reference.md",
      ),
    ).toBeInTheDocument();
    expect(viewer).not.toHaveTextContent("data-analysis");
  });

  it("shows the frontmatter of the file on display, and hides the section when it has none", async () => {
    // Both halves come from one split (#2263), so the section can never show
    // one file's frontmatter beside another file's body — and the viewer never
    // repeats what the section is already showing.
    const user = userEvent.setup();
    const onReadSkillFile = vi.fn(async (uri: string) =>
      uri.endsWith("reference.md")
        ? { text: "# Ref\n\nNo frontmatter here.\n" }
        : { text: "---\nname: data-analysis\n---\n\n# The body\n" },
    );
    renderWithMantine(
      <ControlledSkillsScreen onReadSkillFile={onReadSkillFile} />,
    );
    await user.click(screen.getByText("data-analysis"));
    const viewer = screen.getByTestId("skill-resource-viewer");
    await waitFor(() => expect(viewer).toHaveTextContent("The body"));
    // Shown once, in its own section — not again in the viewer.
    expect(
      screen.getByRole("button", { name: /Frontmatter/ }),
    ).toBeInTheDocument();
    expect(viewer).not.toHaveTextContent("name: data-analysis");

    // reference.md has no frontmatter, so the section goes away entirely
    // rather than lingering with SKILL.md's fields.
    await user.click(
      screen.getByRole("button", {
        name: "skill://data-analysis/reference.md",
      }),
    );
    await waitFor(() =>
      expect(viewer).toHaveTextContent("No frontmatter here"),
    );
    expect(
      screen.queryByRole("button", { name: /Frontmatter/ }),
    ).not.toBeInTheDocument();
  });

  it("lets a .md suffix outrank a generic declared MIME", async () => {
    // Servers routinely serve SKILL.md as `text/plain`. Letting that outrank
    // the suffix meant the file was not recognised as markdown, so its YAML
    // stayed in the viewer and the Frontmatter section disappeared — for a
    // perfectly valid skill.
    const user = userEvent.setup();
    const onReadSkillFile = vi.fn(async () => ({
      text: "---\nname: data-analysis\n---\n\n# The body\n",
      mimeType: "text/plain",
    }));
    renderWithMantine(
      <ControlledSkillsScreen onReadSkillFile={onReadSkillFile} />,
    );
    await user.click(screen.getByText("data-analysis"));
    const viewer = screen.getByTestId("skill-resource-viewer");
    await waitFor(() => expect(viewer).toHaveTextContent("The body"));
    expect(
      screen.getByRole("button", { name: /Frontmatter/ }),
    ).toBeInTheDocument();
    expect(viewer).not.toHaveTextContent("name: data-analysis");
  });

  it("keeps a SPECIFIC declared MIME over the suffix", async () => {
    // The converse: a server that says `text/csv` for a `.md` URI knows its own
    // resource, so the declaration wins and nothing is split.
    const user = userEvent.setup();
    const onReadSkillFile = vi.fn(async () => ({
      text: "---\na,b\n---\n1,2\n",
      mimeType: "text/csv",
    }));
    renderWithMantine(
      <ControlledSkillsScreen onReadSkillFile={onReadSkillFile} />,
    );
    await user.click(screen.getByText("data-analysis"));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /Frontmatter/ }),
      ).not.toBeInTheDocument(),
    );
  });

  it("does not treat an untyped supporting resource as markdown", async () => {
    // SEP-2640 expects a manifest to carry supporting scripts, examples and
    // assets with types of their own. A markdown fallback is right for the
    // skill's OWN SKILL.md and wrong for the rest: an extensionless, untyped
    // blob would be decoded and rendered as markdown rather than as binary.
    const user = userEvent.setup();
    const asset: SkillEntry = {
      uri: "skill://assets/SKILL.md",
      frontmatter: { name: "assets", description: "Has a typeless blob" },
      resources: [
        { uri: "skill://assets/SKILL.md", digest: SELF_DIGEST, size: 1 },
        // No suffix and no mimeType — nothing says what this is.
        { uri: "skill://assets/payload", digest: SELF_DIGEST, size: 1 },
      ],
    };
    const onReadSkillFile = vi.fn(async (uri: string) =>
      uri.endsWith("payload")
        ? { blob: btoa("---\nnot: frontmatter\n---\n\nbinary-ish") }
        : { text: SELF_TEXT, mimeType: "text/markdown" },
    );
    renderWithMantine(
      <ControlledSkillsScreen
        skills={[asset]}
        onReadSkillFile={onReadSkillFile}
      />,
    );
    await user.click(screen.getByText("assets"));
    await user.click(
      screen.getByRole("button", { name: "skill://assets/payload" }),
    );
    // Not split, so no Frontmatter section is invented for it...
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /Frontmatter/ }),
      ).not.toBeInTheDocument(),
    );
  });

  it("marks the row whose file the viewer is showing", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ControlledSkillsScreen />);
    await user.click(screen.getByText("data-analysis"));
    const self = screen.getByRole("button", {
      name: "skill://data-analysis/SKILL.md",
    });
    const other = screen.getByRole("button", {
      name: "skill://data-analysis/reference.md",
    });
    // The skill's own file is what the viewer opens on, so its row is current.
    expect(self).toHaveAttribute("aria-current", "true");
    expect(other).not.toHaveAttribute("aria-current");

    await user.click(other);
    await waitFor(() => expect(other).toHaveAttribute("aria-current", "true"));
    expect(self).not.toHaveAttribute("aria-current");
  });

  it("reports a failed SKILL.md read", async () => {
    const user = userEvent.setup();
    const onReadSkillFile = vi.fn().mockRejectedValue(new Error("gone"));
    renderWithMantine(
      <ControlledSkillsScreen onReadSkillFile={onReadSkillFile} />,
    );
    await user.click(screen.getByText("data-analysis"));
    expect(
      await screen.findByText("Could not read this resource"),
    ).toBeInTheDocument();
    expect(screen.getByText("gone")).toBeInTheDocument();
  });

  it("wraps a non-Error SKILL.md rejection", async () => {
    const user = userEvent.setup();
    const onReadSkillFile = vi.fn().mockRejectedValue("bare");
    renderWithMantine(
      <ControlledSkillsScreen onReadSkillFile={onReadSkillFile} />,
    );
    await user.click(screen.getByText("data-analysis"));
    expect(await screen.findByText("bare")).toBeInTheDocument();
  });

  it("keeps the sections independently collapsible", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ControlledSkillsScreen />);
    // Everything starts open; `right-name` has a finding, so Conformance is
    // open here too rather than auto-collapsed.
    await user.click(screen.getByText("right-name"));
    for (const name of [/Conformance/, /Resources/, /Frontmatter/]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
    }

    // Collapsing one leaves the others alone — `multiple`, not a single-open
    // accordion.
    await user.click(screen.getByRole("button", { name: /Conformance/ }));
    expect(screen.getByRole("button", { name: /Conformance/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByRole("button", { name: /Resources/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("expand-all covers sections that are not visible yet", async () => {
    // `sectionIds` holds only what renders at this instant, and "expand all"
    // used to write exactly that — so a section absent at the moment of the
    // click (Frontmatter, while the read is still in flight; Resources, on a
    // dynamic skill) was DROPPED from the open set, and arrived collapsed with
    // the control offering to expand all over again (#2263).
    const user = userEvent.setup();
    renderWithMantine(<ControlledSkillsScreen />);
    // Start on the dynamic skill, which renders no Resources section at all.
    await user.click(screen.getByText("dynamic-report"));
    // Settle the auto-read before touching the toggle, so the click lands on a
    // known state rather than racing the section set.
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Collapse all|Expand all/ }),
      ).toBeInTheDocument(),
    );
    const toggle = () =>
      screen.getByRole("button", { name: /Collapse all|Expand all/ });
    if (toggle().getAttribute("aria-label") === "Collapse all") {
      await user.click(toggle());
    }
    await user.click(screen.getByRole("button", { name: "Expand all" }));

    // Switch to a static skill WITH findings, so the clean-entry collapse rule
    // does not overlap with what this test is about. Scoped to the sidebar:
    // with every section expanded, the skill's own name also appears in the
    // detail pane's frontmatter block.
    await user.click(
      within(screen.getByTestId("skills-screen")).getAllByText("right-name")[0],
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Resources/ })).toHaveAttribute(
        "aria-expanded",
        "true",
      ),
    );
    expect(screen.getByRole("button", { name: /Frontmatter/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    // And the control agrees that everything is open.
    expect(
      screen.getByRole("button", { name: "Collapse all" }),
    ).toBeInTheDocument();
  });

  it("toggles every section at once from the header control", async () => {
    const user = userEvent.setup();
    renderWithMantine(<ControlledSkillsScreen />);
    const ALL = [/Conformance/, /Resources/, /Frontmatter/, /Skill Resource/];
    await user.click(screen.getByText("right-name"));
    // The shared `ListToggle` element, whose labels are "Expand all" /
    // "Collapse all". Everything starts open, so it offers to collapse first.
    await user.click(screen.getByRole("button", { name: "Collapse all" }));
    for (const name of ALL) {
      expect(screen.getByRole("button", { name })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    }

    // And back the other way from the same control.
    await user.click(screen.getByRole("button", { name: "Expand all" }));
    for (const name of ALL) {
      expect(screen.getByRole("button", { name })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
    }
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

  it("issues exactly one automatic read per selection within a mount", async () => {
    // The app renders under StrictMode, which deliberately replays effects, so
    // without a guard one selection fires two identical `resources/read` calls
    // — and in a protocol inspector a phantom request in the Protocol panel is
    // worse than a wasted round trip: the tool misreports the conversation
    // (#2263). The scope is deliberately one MOUNT: a `ScreenStage` remount
    // mints a fresh ref and reads again, which is correct, because the preview
    // bytes are local state and died with the same unmount.
    const user = userEvent.setup();
    const onReadSkillFile = vi.fn(async () => ({ text: SELF_TEXT }));
    // Mounted with the skill ALREADY selected — a restored `SkillsUiState`.
    //
    // ⚠️ This pins the CONTRACT (one automatic read per selection) rather than
    // guarding it: this environment does not double-invoke mount effects, so
    // the test passes with or without `autoReadKey`. Do not read a pass here as
    // evidence the duplicate-read defect is fixed; that is only observable in a
    // real dev-mode browser. The reappearance test below IS a guard.
    renderWithMantine(
      <StrictMode>
        <ControlledSkillsScreen
          onReadSkillFile={onReadSkillFile}
          ui={{ ...EMPTY_SKILLS_UI, selectedSkillUri: CLEAN_SKILL.uri }}
        />
      </StrictMode>,
    );
    await waitFor(() => expect(onReadSkillFile).toHaveBeenCalledTimes(1));

    // A genuine selection change is a different manifest, so it reads once more.
    await user.click(screen.getAllByText("tampered")[0]);
    await waitFor(() => expect(onReadSkillFile).toHaveBeenCalledTimes(2));
  });

  it("re-reads when the selected entry leaves the list and comes back", async () => {
    // A refresh in flight (or a disconnect) can empty `skills` while the
    // selection persists. The render invalidates the preview, so the viewer is
    // blank — and when the IDENTICAL entry returns its `manifestKey` matches
    // what the guard still holds. Without clearing the guard on the way out,
    // the read is skipped and the viewer stays permanently empty (#2263).
    const onReadSkillFile = vi.fn(async () => ({
      text: "---\nname: data-analysis\n---\n\nreloaded-body\n",
    }));
    const selectedUi = {
      ...EMPTY_SKILLS_UI,
      selectedSkillUri: CLEAN_SKILL.uri,
    };
    const { rerender } = renderWithMantine(
      <ControlledSkillsScreen
        onReadSkillFile={onReadSkillFile}
        ui={selectedUi}
      />,
    );
    await waitFor(() => expect(onReadSkillFile).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId("skill-resource-viewer")).toHaveTextContent(
        "reloaded-body",
      ),
    );

    rerender(
      <ControlledSkillsScreen
        onReadSkillFile={onReadSkillFile}
        skills={[]}
        ui={selectedUi}
      />,
    );
    rerender(
      <ControlledSkillsScreen
        onReadSkillFile={onReadSkillFile}
        ui={selectedUi}
      />,
    );

    await waitFor(() => expect(onReadSkillFile).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByTestId("skill-resource-viewer")).toHaveTextContent(
        "reloaded-body",
      ),
    );
  });

  it("re-points the viewer at the newly selected skill's own file", async () => {
    const user = userEvent.setup();
    const onReadSkillFile = vi.fn(async (uri: string) => ({
      text: `contents of ${uri}\n`,
    }));
    renderWithMantine(
      <ControlledSkillsScreen onReadSkillFile={onReadSkillFile} />,
    );
    await user.click(screen.getByText("data-analysis"));
    const viewer = screen.getByTestId("skill-resource-viewer");
    await waitFor(() =>
      expect(viewer).toHaveTextContent("contents of skill://data-analysis"),
    );

    // The previous skill's contents must not survive the switch: the viewer
    // follows the selection rather than holding whatever was last read.
    await user.click(screen.getByText("tampered"));
    // Re-queried, not reused: the accordion is keyed by the manifest so that a
    // skill change gives every panel a fresh scroll container (#2263), which
    // means the node captured above is detached and frozen on the old content.
    await waitFor(() =>
      expect(screen.getByTestId("skill-resource-viewer")).toHaveTextContent(
        "contents of skill://tampered/SKILL.md",
      ),
    );
    expect(screen.getByTestId("skill-resource-viewer")).not.toHaveTextContent(
      "contents of skill://data-analysis",
    );
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
    // `release` now holds the resolver for the SECOND skill's auto-read; the
    // first skill's is stranded, which is the point — resolving the older one
    // must not publish into the newer selection.
    const stale = release;
    await user.click(screen.getByText("tampered"));
    stale?.({ text: "# from the abandoned skill\n" });
    expect(screen.getByTestId("skill-resource-viewer")).not.toHaveTextContent(
      "abandoned",
    );
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
    // The abandoned skill's own read, stranded by the selection change below.
    const stale = fail;
    await user.click(screen.getByText("tampered"));
    stale?.(new Error("too late"));
    expect(screen.queryByText("too late")).not.toBeInTheDocument();
  });
});
