import type { Root } from "@modelcontextprotocol/sdk/types.js";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { RootsTable } from "./RootsTable";

const sampleRoots: Root[] = [
  { name: "Project Source", uri: "file:///home/user/project/src" },
  { name: "Configuration", uri: "file:///home/user/project/config" },
  { name: "Documentation", uri: "file:///home/user/project/docs" },
];

const meta: Meta<typeof RootsTable> = {
  title: "Groups/RootsTable",
  component: RootsTable,
  args: {
    onRemoveRoot: fn(),
    onNewRootDraftChange: fn(),
    onAddRoot: fn(),
    onBrowse: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof RootsTable>;

export const WithRoots: Story = {
  args: {
    roots: sampleRoots,
    newRootDraft: { name: "", uri: "" },
  },
};

export const Empty: Story = {
  args: {
    roots: [],
    newRootDraft: { name: "", uri: "" },
  },
};

export const AddingNew: Story = {
  args: {
    roots: [sampleRoots[0]],
    newRootDraft: {
      name: "Test Data",
      uri: "file:///home/user/project/test-data",
    },
  },
};

export const ManyRoots: Story = {
  args: {
    roots: [
      { name: "Source Code", uri: "file:///home/user/project/src" },
      { name: "Configuration", uri: "file:///home/user/project/config" },
      { name: "Documentation", uri: "file:///home/user/project/docs" },
      {
        name: "Test Fixtures",
        uri: "file:///home/user/project/test/fixtures",
      },
      { name: "Build Output", uri: "file:///home/user/project/dist" },
      { name: "Scripts", uri: "file:///home/user/project/scripts" },
    ],
    newRootDraft: { name: "", uri: "" },
  },
};
