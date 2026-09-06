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
    // Echoes back the entry `skills/list` advertised, so "Fetch with
    // skills/get" demonstrates the matching case rather than throwing.
    onGetSkill: fn(async (uri: string) => {
      const found = sampleSkills.find((skill) => skill.uri === uri);
      if (!found) throw new Error(`Unknown skill uri: ${uri}`);
      return found;
    }),
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
    // A clean entry opens with Conformance COLLAPSED (#2263) — its badge
    // already carries the whole answer — so the verdict is behind one click.
    const control = canvas.getByRole("button", { name: /Conformance/ });
    await expect(control).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(control);
    await expect(canvas.getByText("No structural issues")).toBeInTheDocument();
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

// A SKILL.md long enough to overflow the viewer. Every other fixture here is a
// line or two, which is precisely why the layout regression this screen was
// refactored for could not be caught in a story: with short content the viewer
// never scrolls, so a pane that scrolls as one column looks identical to one
// that does not (#2263).
const LONG_SKILL_MD = [
  "---",
  "name: data-analysis",
  "description: Analyze a CSV and summarize its columns",
  "---",
  "",
  "# Data analysis",
  "",
  ...Array.from(
    { length: 40 },
    (_, i) =>
      `Paragraph ${i + 1}. Read the file as UTF-8 and sniff the delimiter from ` +
      "the header line rather than assuming a comma, because a mis-sniffed " +
      "delimiter yields a single column whose name is the entire header.\n",
  ),
].join("\n");

// A conforming manifest may declare up to 512 files. This is the sibling case
// to a long document: the metadata section, not the viewer, is what holds the
// overflowing content.
const manyFilesSkill: SkillEntry = {
  uri: "skill://big-manifest/SKILL.md",
  frontmatter: {
    name: "big-manifest",
    description: "A conforming skill that declares a great many files",
  },
  resources: [
    selfEntry("big-manifest"),
    ...Array.from({ length: 120 }, (_, i) => ({
      uri: `skill://big-manifest/file-${String(i).padStart(3, "0")}.md`,
      digest: REF_DIGEST,
      size: 15,
    })),
  ],
};

/**
 * The other half of the layout contract: a huge **manifest**, rather than a
 * huge document.
 *
 * A section that keeps its full intrinsic height pushes the file viewer off the
 * bottom of the pane, so reaching the file means scrolling past the manifest —
 * which is the "the file is behind the manifest" problem this screen exists to
 * end. The metadata sections must therefore shrink to their floor and scroll
 * internally, leaving the viewer on screen.
 */
export const LongManifest: Story = {
  args: {
    skills: [manyFilesSkill],
    onReadSkillFile: fn(async () => ({
      text: "---\nname: big-manifest\n---\n\n# Big manifest\n",
      mimeType: "text/markdown",
    })),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("big-manifest"));
    const viewerControl = await canvas.findByRole("button", {
      name: /Skill Resource/,
    });

    const detailCard = canvasElement.querySelectorAll(".mantine-Card-root")[1];
    if (!(detailCard instanceof HTMLElement)) {
      throw new Error("Detail card not found");
    }

    // The viewer's header is ON SCREEN, not pushed below the manifest.
    const cardRect = detailCard.getBoundingClientRect();
    const viewerRect = viewerControl.getBoundingClientRect();
    await expect(viewerRect.bottom).toBeLessThanOrEqual(cardRect.bottom + 1);

    // The manifest section gave up space rather than keeping its full height,
    // so its own panel is what scrolls.
    const resourcesControl = canvas.getByRole("button", { name: /Resources/ });
    const resourcesPanel = resourcesControl
      .closest(".mantine-Accordion-item")
      ?.querySelector(".mantine-Accordion-panel");
    if (!(resourcesPanel instanceof HTMLElement)) {
      throw new Error("Resources panel not found");
    }
    await expect(resourcesPanel.scrollHeight).toBeGreaterThan(
      resourcesPanel.clientHeight,
    );

    // And the pane still does not scroll as one column.
    await expect(detailCard.scrollHeight).toBeLessThanOrEqual(
      detailCard.clientHeight + 1,
    );
  },
};

// A skill whose every server-controlled header string is hostile: a very long
// name, a URI with many breakable segments, and a description at the upper end
// of what SEP-2640 permits.
const HOSTILE_NAME = "an-extremely-long-skill-name-".repeat(8);
// A manifest entry whose FILENAME is hostile, not just its path — selecting it
// puts that name in the Skill Resource control, which is pinned and does not
// scroll.
const HOSTILE_FILE_URI = `skill://${"very-long-path-segment/".repeat(30)}${"a-very-long-file-name-".repeat(10)}.md`;
const hostileHeaderSkill: SkillEntry = {
  uri: `skill://${"very-long-path-segment/".repeat(30)}SKILL.md`,
  frontmatter: {
    name: HOSTILE_NAME,
    description: "word ".repeat(400).trim(),
  },
  resources: [
    {
      uri: `skill://${"very-long-path-segment/".repeat(30)}SKILL.md`,
      digest: SELF_DIGEST,
      size: 8,
    },
    { uri: HOSTILE_FILE_URI, digest: SELF_DIGEST, size: 8 },
  ],
};

/**
 * The pane's fixed header cannot starve the accordion.
 *
 * The header is a sibling of an accordion whose flex-basis is `0`, so every
 * unbounded string in it is subtracted from the sections rather than resisted
 * by them. That has been the same defect three times in this PR — the viewer's
 * content-sized basis, the `skills/get` region, and the description — so this
 * asserts the whole class is closed rather than any one instance.
 */
export const HostileHeader: Story = {
  args: {
    skills: [hostileHeaderSkill],
    onReadSkillFile: fn(async () => ({
      text: "---\nname: x\n---\n\n# Body\n",
      mimeType: "text/markdown",
    })),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getAllByText(HOSTILE_NAME)[0]);
    await canvas.findByRole("button", { name: /Skill Resource/ });

    const detailCard = canvasElement.querySelectorAll(".mantine-Card-root")[1];
    const accordion = canvasElement.querySelector(".disclosure-sections");
    if (
      !(detailCard instanceof HTMLElement) ||
      !(accordion instanceof HTMLElement)
    ) {
      throw new Error("detail card or accordion not found");
    }

    // The header takes a minority of the pane, leaving the sections the rest.
    const cardHeight = detailCard.getBoundingClientRect().height;
    const accordionHeight = accordion.getBoundingClientRect().height;
    await expect(accordionHeight).toBeGreaterThan(cardHeight * 0.5);

    // Every section is still usable, and the pane still does not scroll.
    for (const item of accordion.querySelectorAll(
      ":scope > .mantine-Accordion-item",
    )) {
      await expect(item.getBoundingClientRect().height).toBeGreaterThan(0);
    }
    await expect(detailCard.scrollHeight).toBeLessThanOrEqual(
      detailCard.clientHeight + 1,
    );

    // Selecting the resource with the hostile FILENAME puts it in the Skill
    // Resource control, which is pinned and does not scroll — so it has to be
    // clamped too, or the header grows instead.
    // Measure the control while a SHORT name is displayed, then select the
    // hostile one: a clamped caption leaves the control the same height, an
    // unclamped one grows it. Comparing against its own baseline is what makes
    // this detect the defect — an absolute threshold does not, because even an
    // unclamped name only wraps to a few lines.
    const control = await canvas.findByRole("button", {
      name: /Skill Resource/,
    });
    const controlBefore = control.getBoundingClientRect().height;
    const accordionBefore = accordion.getBoundingClientRect().height;
    await userEvent.click(
      canvas.getByRole("button", { name: HOSTILE_FILE_URI }),
    );
    await expect(
      Math.abs(control.getBoundingClientRect().height - controlBefore),
    ).toBeLessThanOrEqual(1);
    await expect(
      Math.abs(accordion.getBoundingClientRect().height - accordionBefore),
    ).toBeLessThanOrEqual(1);
    await expect(detailCard.scrollHeight).toBeLessThanOrEqual(
      detailCard.clientHeight + 1,
    );
  },
};

/**
 * The layout contract, asserted in a real browser.
 *
 * This is the regression the refactor exists to prevent, and it is only visible
 * with content that overflows: the file viewer must scroll **inside its own
 * panel** while its sibling sections keep usable height, rather than the whole
 * pane scrolling as one column.
 *
 * It also pins the collapse-then-reopen case, which is how the original bug
 * actually presented — the viewer's content-sized `flex-basis` crushed its
 * siblings, so collapsing it laid out correctly and reopening it broke again.
 */
export const LongSkillDocument: Story = {
  args: {
    onReadSkillFile: fn(async () => ({
      text: LONG_SKILL_MD,
      mimeType: "text/markdown",
    })),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText("data-analysis"));
    const viewerControl = await canvas.findByRole("button", {
      name: /Skill Resource/,
    });

    const sections = () => [
      ...canvasElement.querySelectorAll(
        ".disclosure-sections > .mantine-Accordion-item",
      ),
    ];
    const geometry = () =>
      sections().map((s) => Math.round(s.getBoundingClientRect().height));

    // Every section keeps a usable height: none is crushed to nothing by the
    // viewer's content, which is exactly what a content-sized basis did.
    const before = geometry();
    await expect(before.length).toBeGreaterThanOrEqual(3);
    for (const height of before) {
      await expect(height).toBeGreaterThan(0);
    }

    // Sections tile in document order — none overlaps the header below it,
    // which is how the crushed layout showed up on screen.
    const rects = sections().map((s) => s.getBoundingClientRect());
    for (let i = 1; i < rects.length; i++) {
      await expect(Math.round(rects[i].top)).toBeGreaterThanOrEqual(
        Math.round(rects[i - 1].bottom) - 1,
      );
    }

    // The viewer scrolls WITHIN its own panel rather than growing the pane.
    const viewerPanel = viewerControl
      .closest(".mantine-Accordion-item")
      ?.querySelector(".mantine-Accordion-panel");
    if (!(viewerPanel instanceof HTMLElement)) {
      throw new Error("Skill Resource panel not found");
    }
    await expect(viewerPanel.scrollHeight).toBeGreaterThan(
      viewerPanel.clientHeight,
    );

    // And the detail pane itself does not scroll as one column.
    const detailCard = canvasElement.querySelectorAll(".mantine-Card-root")[1];
    if (!(detailCard instanceof HTMLElement)) {
      throw new Error("Detail card not found");
    }
    await expect(detailCard.scrollHeight).toBeLessThanOrEqual(
      detailCard.clientHeight + 1,
    );

    // Collapse then reopen restores the same geometry.
    await userEvent.click(viewerControl);
    await userEvent.click(viewerControl);
    await expect(geometry()).toEqual(before);
  },
};
