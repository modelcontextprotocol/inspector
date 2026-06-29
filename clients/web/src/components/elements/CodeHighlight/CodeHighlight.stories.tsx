import type { Meta, StoryObj } from "@storybook/react-vite";
import { CodeHighlight } from "./CodeHighlight";

const meta: Meta<typeof CodeHighlight> = {
  title: "Elements/CodeHighlight",
  component: CodeHighlight,
};

export default meta;
type Story = StoryObj<typeof CodeHighlight>;

export const Json: Story = {
  args: {
    language: "json",
    code: JSON.stringify(
      { name: "my-app", version: "1.0.0", tags: ["a", "b"] },
      null,
      2,
    ),
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
