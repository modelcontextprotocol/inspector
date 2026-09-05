import { useState } from "react";
import type { ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import type { SkillEntry } from "@inspector/core/mcp/skillsSchemas";
import { SkillsScreen } from "./SkillsScreen";
import type { SkillsUiState } from "./SkillsScreen";
import { EMPTY_SKILLS_UI } from "../screenUiState";

// SkillsScreen is controlled (selection and search live in the parent as one
// `ui` object — see #1417). This wrapper holds that state so the play-driven
// clicks drive the detail pane, mirroring how App owns it in the real app.
function StatefulSkillsScreen(args: ComponentProps<typeof SkillsScreen>) {
  const [ui, setUi] = useState<SkillsUiState>(args.ui ?? EMPTY_SKILLS_UI);
  return <SkillsScreen {...args} ui={ui} onUiChange={setUi} />;
}

const REF_TEXT = "# Column rules\n";
const SELF_TEXT = "# skill\n";
// The real digests of those two strings, so the clean skill actually verifies
// when the "Verify all" story runs — a placeholder would demo a false green.
const REF_DIGEST =
  "sha256:e201429aa2684958ca1a0537ab4eb4b7eb3a81c71e7cc7a11397eb500738e015";
const SELF_DIGEST =
  "sha256:6504f2de0a1febf7492c3b98f93d9ab49558eb364607a706f02fe9a75aa7f75b";

/** Every manifest lists the skill's own SKILL.md — a manifest is the complete
 *  file set, so one that omits it is a `manifest-missing-self` error. */
const selfEntry = (path: string) => ({
  uri: `skill://${path}/SKILL.md`,
  digest: SELF_DIGEST,
  size: 8,
});

const sampleSkills: SkillEntry[] = [
  {
    uri: "skill://data-analysis/SKILL.md",
    frontmatter: {
      name: "data-analysis",
      description: "Analyze a CSV and summarize its columns",
    },
    resources: [
      selfEntry("data-analysis"),
      {
        uri: "skill://data-analysis/reference.md",
        digest: REF_DIGEST,
        size: 15,
      },
    ],
  },
  {
    uri: "skill://tampered-notes/SKILL.md",
    frontmatter: {
      name: "tampered-notes",
      description: "Advertises a digest its bytes do not match",
    },
    resources: [
      selfEntry("tampered-notes"),
      {
        // A well-formed digest of bytes the fake read does not return, with a
        // size that agrees — so the reported failure is a *digest* mismatch
        // rather than the cheaper size cross-check.
        uri: "skill://tampered-notes/notes.md",
        digest: `sha256:${"b".repeat(64)}`,
        size: 8,
      },
    ],
  },
  {
    uri: "skill://dynamic-report/SKILL.md",
    frontmatter: {
      name: "dynamic-report",
      description: "Generated files, so integrity cannot be verified",
    },
    resources: "dynamic",
  },
  {
    uri: "skill://wrong-folder/SKILL.md",
    frontmatter: {
      name: "right-name",
      description: "URI path segment disagrees with frontmatter.name",
    },
    resources: [selfEntry("wrong-folder")],
  },
];

const meta: Meta<typeof SkillsScreen> = {
  title: "Screens/SkillsScreen",
  component: SkillsScreen,
  parameters: { layout: "fullscreen" },
  args: {
    skills: sampleSkills,
    pageCount: 2,
    ui: EMPTY_SKILLS_UI,
    onUiChange: fn(),
    onRefreshList: fn(),
    onReadSkillFile: fn(async (uri: string) =>
      uri.endsWith("reference.md")
        ? { text: REF_TEXT }
        : { text: SELF_TEXT, mimeType: "text/markdown" },
    ),
  },
  render: (args) => <StatefulSkillsScreen {...args} />,
};

export default meta;
type Story = StoryObj<typeof SkillsScreen>;

export const Default: Story = {};

export const Empty: Story = {
  args: { skills: [], pageCount: 0 },
};

export const LoadFailed: Story = {
  args: { loadError: new Error("skills/list failed: -32601 Method not found") },
};

export const ConformingSkill: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("data-analysis"));
    await expect(canvas.getByText("Conforms")).toBeInTheDocument();
  },
};

export const NameMismatch: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("right-name"));
    await expect(canvas.getByText("name-path-mismatch")).toBeInTheDocument();
  },
};

export const DynamicResources: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("dynamic-report"));
    await expect(canvas.getByText("Dynamic resources")).toBeInTheDocument();
  },
};

export const DigestMismatch: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("tampered-notes"));
    await userEvent.click(canvas.getByRole("button", { name: /Verify all/ }));
    await expect(
      await canvas.findByText("Digest mismatch"),
    ).toBeInTheDocument();
  },
};
