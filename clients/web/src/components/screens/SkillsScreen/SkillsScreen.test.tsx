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
// Computed once at module load so the fixture's advertised digest really is the
// digest of the bytes the fake read returns — a hard-coded constant here would
// make the "verified" test pass for the wrong reason if the encoder changed.
const REF_DIGEST = await sha256Digest(textToBytes(REF_TEXT));

const CLEAN_SKILL: SkillEntry = {
  uri: "skill://data-analysis/SKILL.md",
  frontmatter: {
    name: "data-analysis",
    description: "Analyze a CSV and summarize its columns",
  },
  resources: [
    {
      uri: "skill://data-analysis/reference.md",
      digest: REF_DIGEST,
      size: REF_TEXT.length,
    },
  ],
};

const TAMPERED_SKILL: SkillEntry = {
  uri: "skill://tampered/SKILL.md",
  frontmatter: { name: "tampered", description: "Bad digest" },
  resources: [
    {
      uri: "skill://tampered/notes.md",
      digest: `sha256:${"b".repeat(64)}`,
      size: 4,
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
  resources: [],
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
  if (uri === "skill://tampered/notes.md") return { text: "different\n" };
  return { text: `# ${uri}\n`, mimeType: "text/markdown" };
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
    expect(await screen.findByText("verified")).toBeInTheDocument();
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
    await user.click(within(manifest).getByRole("button", { name: "Verify" }));
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
    expect(await screen.findByText("Could not read file")).toBeInTheDocument();
    expect(screen.getByText("403")).toBeInTheDocument();
  });

  it("wraps a non-Error read rejection", async () => {
    const user = userEvent.setup();
    const onReadSkillFile = vi.fn().mockRejectedValue("plain string");
    renderWithMantine(
      <ControlledSkillsScreen onReadSkillFile={onReadSkillFile} />,
    );
    await user.click(screen.getByText("data-analysis"));
    await user.click(screen.getByRole("button", { name: /Verify all/ }));
    expect(await screen.findByText("plain string")).toBeInTheDocument();
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
    expect(await screen.findByText("verified")).toBeInTheDocument();

    // A verdict belongs to the skill it was computed for; carrying it across a
    // selection change would attribute one skill's result to another.
    await user.click(screen.getByText("tampered"));
    expect(screen.queryByText("verified")).not.toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
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

  it("renders an em dash for a manifest entry with no size", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ControlledSkillsScreen
        skills={[
          {
            ...CLEAN_SKILL,
            resources: [{ uri: "skill://data-analysis/reference.md" }],
          },
        ]}
      />,
    );
    await user.click(screen.getByText("data-analysis"));
    const manifest = screen.getByTestId("skill-manifest");
    // Three em dashes in the row: the size cell, the digest cell, and the
    // not-yet-run verification badge — which stays distinct from
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
              { uri: "skill://data-analysis/a.md", digest: "sha256:short" },
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
            resources: [{ uri: "skill://data-analysis/reference.md" }],
          },
        ]}
      />,
    );
    await user.click(screen.getByText("data-analysis"));
    await user.click(screen.getByRole("button", { name: /Verify all/ }));
    expect(await screen.findByText("unverifiable")).toBeInTheDocument();
  });
});
