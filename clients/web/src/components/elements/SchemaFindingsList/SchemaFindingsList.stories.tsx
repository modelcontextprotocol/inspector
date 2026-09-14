import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import type { Tool } from "@modelcontextprotocol/client";
import { lintToolSchemas } from "@inspector/core/json/schemaLint.js";
import { SchemaFindingsList } from "./SchemaFindingsList";

/** Lint a schema fixture the way the real panels do, so the stories show the
 * module's own wording rather than hand-written findings that could drift. */
function findingsFor(tool: Partial<Tool>) {
  return lintToolSchemas({ name: "info", ...tool } as Tool);
}

const meta: Meta<typeof SchemaFindingsList> = {
  title: "Elements/SchemaFindingsList",
  component: SchemaFindingsList,
  // The component is controlled (the expand preference is global — see
  // `useSchemaFindingsExpanded`), so the stories own the state that the real
  // caller keeps in localStorage. `args.expanded` seeds it.
  render: function Render(args) {
    const [expanded, setExpanded] = useState(args.expanded);
    return (
      <SchemaFindingsList
        {...args}
        expanded={expanded}
        onExpandedChange={setExpanded}
      />
    );
  },
};

export default meta;
type Story = StoryObj<typeof SchemaFindingsList>;

/** The reported case: Go's `jsonschema` emits `true` for an `interface{}`. */
export const BareTrueProperty: Story = {
  args: {
    expanded: true,
    findings: findingsFor({
      outputSchema: {
        type: "object",
        properties: { data: true, topic: { type: "string" } },
      },
    } as Partial<Tool>),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Schema portability")).toBeVisible();
    await expect(canvas.getByText("1 error(s), 0 warning(s)")).toBeVisible();
    await expect(canvas.getByText("error")).toBeVisible();
    await expect(
      canvas.getByText("outputSchema.properties.data"),
    ).toBeVisible();
  },
};

/** Warning-only: an array-form `type`, legal but read unevenly. */
export const TypeUnionWarning: Story = {
  args: {
    expanded: true,
    findings: findingsFor({
      inputSchema: {
        type: "object",
        properties: { show_ids: { type: ["null", "boolean"] } },
      },
    } as Partial<Tool>),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("warning")).toBeVisible();
    await expect(canvas.queryByText("error")).toBeNull();
  },
};

/** Both severities on one tool, which is what a real problem server looks like. */
export const Mixed: Story = {
  args: {
    expanded: true,
    findings: findingsFor({
      inputSchema: {
        type: "object",
        properties: {
          show_ids: { type: ["null", "boolean"] },
          extra: {},
          ref: { $ref: "https://example.com/s.json" },
        },
      },
      outputSchema: { type: "object", properties: { data: true } },
    } as Partial<Tool>),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("1 error(s), 3 warning(s)")).toBeVisible();
  },
};

/**
 * How the panel actually opens (#2205): one summary line, findings behind it.
 * The counts stay on screen, so collapsing does not hide that the tool has
 * findings — and one click brings the detail back.
 */
export const Collapsed: Story = {
  args: {
    expanded: false,
    findings: findingsFor({
      inputSchema: {
        type: "object",
        properties: {
          show_ids: { type: ["null", "boolean"] },
          extra: {},
          ref: { $ref: "https://example.com/s.json" },
        },
      },
      outputSchema: { type: "object", properties: { data: true } },
    } as Partial<Tool>),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("1 error(s), 3 warning(s)")).toBeVisible();

    const toggle = canvas.getByRole("button", { name: /Schema portability/ });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(toggle);

    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    // The panel animates open, so the reveal is only true once the collapse
    // transition has run — asserting straight after the click races it.
    await waitFor(async () => {
      await expect(
        canvas.getByText("outputSchema.properties.data"),
      ).toBeVisible();
    });
  },
};

/** The common case — nothing to say, so the section renders nothing at all. */
export const Clean: Story = {
  args: { expanded: true, findings: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId("schema-findings")).toBeNull();
  },
};
