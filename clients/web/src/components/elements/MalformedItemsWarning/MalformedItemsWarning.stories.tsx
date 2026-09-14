import type { Meta, StoryObj } from "@storybook/react-vite";
import { MalformedItemsWarning } from "./MalformedItemsWarning";

const meta: Meta<typeof MalformedItemsWarning> = {
  title: "Elements/MalformedItemsWarning",
  component: MalformedItemsWarning,
};

export default meta;
type Story = StoryObj<typeof MalformedItemsWarning>;

/** The failure this was built for: a PHP server whose empty `annotations`
 *  object reaches the wire as `[]` (#1909). */
export const OneDroppedTemplate: Story = {
  args: {
    method: "resources/templates/list",
    what: "resource templates",
    items: [
      {
        method: "resources/templates/list",
        index: 1,
        label: "array_annotations",
        reason: "annotations: Invalid input: expected object, received array",
      },
    ],
  },
};

export const SeveralDropped: Story = {
  args: {
    method: "tools/list",
    what: "tools",
    items: [
      {
        method: "tools/list",
        index: 0,
        label: "get_weather",
        reason: "inputSchema: Invalid input: expected object, received string",
      },
      {
        method: "tools/list",
        index: 4,
        label: "add",
        reason: "name: Invalid input: expected string, received number",
      },
    ],
  },
};

/** An entry too broken to carry a name is reported by its position. */
export const UnlabeledEntry: Story = {
  args: {
    method: "prompts/list",
    what: "prompts",
    items: [
      {
        method: "prompts/list",
        index: 2,
        reason: "Invalid input: expected object, received null",
      },
    ],
  },
};

/** Entries belonging to another list method are ignored — the same set is
 *  passed to every panel, and each selects its own. */
export const OtherMethodOnly: Story = {
  args: {
    method: "resources/templates/list",
    what: "resource templates",
    items: [
      {
        method: "tools/list",
        index: 0,
        label: "get_weather",
        reason: "inputSchema: Invalid input: expected object, received string",
      },
    ],
  },
};

/** The resting state: a conforming server, nothing rendered. */
export const Conforming: Story = {
  args: {
    method: "resources/templates/list",
    what: "resource templates",
    items: [],
  },
};
