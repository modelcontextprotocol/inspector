import type { Meta, StoryObj } from "@storybook/react-vite";
import { CodeHighlight } from "./CodeHighlight";

const meta: Meta<typeof CodeHighlight> = {
  title: "Elements/CodeHighlight",
  component: CodeHighlight,
};

export default meta;
type Story = StoryObj<typeof CodeHighlight>;

// No JSON story: JSON is rendered by `JsonEditor` (read-only), not here (#2151).
export const Yaml: Story = {
  args: {
    language: "yaml",
    code: "name: my-app\nversion: 1.0.0\ntags:\n  - a\n  - b",
  },
};

export const Xml: Story = {
  args: {
    language: "xml",
    code: '<root>\n  <item id="1">first</item>\n  <item id="2">second</item>\n</root>',
  },
};

export const Css: Story = {
  args: {
    language: "css",
    code: ".card {\n  color: var(--text);\n  padding: 1rem;\n}",
  },
};

export const UnknownLanguage: Story = {
  args: {
    language: "brainfuck",
    code: "++++++++[>++++[>++>+++<<-]>+>->]",
  },
};
