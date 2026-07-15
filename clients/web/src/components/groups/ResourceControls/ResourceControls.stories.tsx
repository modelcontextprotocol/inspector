import type { Meta, StoryObj } from "@storybook/react-vite";
import type {
  Resource,
  ResourceTemplateType as ResourceTemplate,
} from "@modelcontextprotocol/client";
import type { InspectorResourceSubscription } from "../../../../../../core/mcp/types.js";
import { expect, fn, within } from "storybook/test";
import { ResourceControls } from "./ResourceControls";

// rotate(90deg) — Mantine sets `data-rotate` on the chevron slot of an open
// section; App.css rotates the right-pointing arrow 90° so it points down.
const ROTATED_DOWN = "matrix(0, 1, -1, 0, 0, 0)";
// Identity — a closed section's right-pointing chevron at its natural 0°.
const NOT_ROTATED = "matrix(1, 0, 0, 1, 0, 0)";

function chevronTransforms(canvasElement: HTMLElement): string[] {
  // Scoped to the accordion root so it still works if a story ever renders more
  // than one disclosure accordion on the canvas.
  const root = canvasElement.querySelector(".disclosure-sections");
  return [
    ...(root ?? canvasElement).querySelectorAll(".disclosure-chevron"),
  ].map((c) => getComputedStyle(c).transform);
}

const meta: Meta<typeof ResourceControls> = {
  title: "Groups/ResourceControls",
  component: ResourceControls,
  args: {
    onRefreshList: fn(),
    onSelectUri: fn(),
    onSelectTemplate: fn(),
    onUnsubscribeResource: fn(),
    onSearchChange: fn(),
    onOpenSectionsChange: fn(),
    listChanged: false,
    compact: false,
    onCompactChange: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ResourceControls>;

const sampleResources: Resource[] = [
  {
    name: "config.json",
    uri: "file:///config.json",
    annotations: { audience: ["user"], priority: 0.8 },
  },
  {
    name: "README.md",
    uri: "file:///README.md",
  },
  {
    name: "schema.sql",
    uri: "file:///schema.sql",
  },
];

const sampleTemplates: ResourceTemplate[] = [
  {
    name: "User Profile",
    uriTemplate: "file:///users/{userId}/profile",
  },
];

const sampleSubscriptions: InspectorResourceSubscription[] = [
  {
    resource: {
      name: "config.json",
      uri: "file:///config.json",
    },
    lastUpdated: new Date("2026-03-17T10:30:00Z"),
  },
];

export const Default: Story = {
  args: {
    resources: sampleResources,
    templates: sampleTemplates,
    subscriptions: sampleSubscriptions,
  },
  // All three populated sections open by default (compact=false) → every
  // chevron points down.
  play: async ({ canvasElement }) => {
    const transforms = chevronTransforms(canvasElement);
    expect(transforms).toHaveLength(3);
    for (const t of transforms) expect(t).toBe(ROTATED_DOWN);
  },
};

export const WithSearch: Story = {
  args: {
    ...Default.args,
  },
};

export const ListChanged: Story = {
  args: {
    ...Default.args,
    listChanged: true,
  },
};

export const Empty: Story = {
  args: {
    resources: [],
    templates: [],
    subscriptions: [],
  },
};

// Sections explicitly collapsed: every chevron points right (no rotation).
export const Collapsed: Story = {
  args: {
    resources: sampleResources,
    templates: sampleTemplates,
    subscriptions: sampleSubscriptions,
    openSections: [],
  },
  play: async ({ canvasElement }) => {
    const transforms = chevronTransforms(canvasElement);
    expect(transforms).toHaveLength(3);
    // Identity matrix = the right-pointing arrow's natural 0° (not rotated).
    for (const t of transforms) expect(t).toBe(NOT_ROTATED);
  },
};

// Populated URIs/Templates but no Subscriptions, all "open" in intent. The
// empty Subscriptions section is kept out of the open set, so its chevron
// points right while the two populated ones point down.
export const EmptySectionCollapsed: Story = {
  args: {
    resources: sampleResources,
    templates: sampleTemplates,
    subscriptions: [],
    openSections: ["resources", "templates", "subscriptions"],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("Subscriptions (0)")).toBeInTheDocument();
    const transforms = chevronTransforms(canvasElement);
    const downCount = transforms.filter((t) => t === ROTATED_DOWN).length;
    expect(downCount).toBe(2); // URIs + Templates down, Subscriptions right
  },
};

// Server does not advertise resources.subscribe: the Subscriptions section is
// omitted entirely, leaving only URIs and Templates (#1478).
export const SubscriptionsUnsupported: Story = {
  args: {
    resources: sampleResources,
    templates: sampleTemplates,
    subscriptions: sampleSubscriptions,
    subscriptionsSupported: false,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.queryByText(/Subscriptions/)).not.toBeInTheDocument();
    // Only the two remaining sections render, both open → both chevrons down.
    const transforms = chevronTransforms(canvasElement);
    expect(transforms).toHaveLength(2);
    for (const t of transforms) expect(t).toBe(ROTATED_DOWN);
  },
};

// Many URIs with sparse Templates/Subscriptions: under the old equal `/ n`
// height split, URIs scrolled while the others left their share unused. Now the
// sections size to content inside one bounded scroll region.
const manyResources: Resource[] = Array.from({ length: 30 }, (_, i) => ({
  name: `resource-${String(i + 1).padStart(2, "0")}.md`,
  uri: `file:///docs/resource-${i + 1}.md`,
}));

export const ManyResources: Story = {
  args: {
    resources: manyResources,
    templates: sampleTemplates,
    subscriptions: sampleSubscriptions,
  },
};
