import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { SkillEntry } from "@inspector/core/mcp/skillsSchemas";
import { sha256Digest, textToBytes } from "@inspector/core/mcp/skills";
import {
  renderWithMantine,
  screen,
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
