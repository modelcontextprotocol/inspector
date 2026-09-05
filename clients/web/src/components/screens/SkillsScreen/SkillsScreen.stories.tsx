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
// The digest of REF_TEXT, so the clean skill really does verify when the
// "Verify all" story runs — a placeholder here would demo a false green.
const REF_DIGEST =
  "sha256:e201429aa2684958ca1a0537ab4eb4b7eb3a81c71e7cc7a11397eb500738e015";

const sampleSkills: SkillEntry[] = [
  {
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
  },
  {
    uri: "skill://tampered-notes/SKILL.md",
    frontmatter: {
      name: "tampered-notes",
      description: "Advertises a digest its bytes do not match",
    },
    resources: [
      {
        uri: "skill://tampered-notes/notes.md",
        digest: `sha256:${"b".repeat(64)}`,
        size: 12,
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
    resources: [],
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
        : { text: `# ${uri}\n`, mimeType: "text/markdown" },
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
