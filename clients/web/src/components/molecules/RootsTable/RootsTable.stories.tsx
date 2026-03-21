import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { RootsTable } from "./RootsTable";

const meta: Meta<typeof RootsTable> = {
  title: "Molecules/RootsTable",
  component: RootsTable,
  args: {
    onRemoveRoot: fn(),
    onNewRootNameChange: fn(),
    onNewRootPathChange: fn(),
    onAddRoot: fn(),
    onBrowse: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof RootsTable>;

export const WithRoots: Story = {
  args: {
    roots: [
      { name: "Project Source", uri: "file:///home/user/project/src" },
      { name: "Configuration", uri: "file:///home/user/project/config" },
      { name: "Documentation", uri: "file:///home/user/project/docs" },
    ],
    newRootName: "",
    newRootPath: "",
  },
};

export const Empty: Story = {
  args: {
    roots: [],
    newRootName: "",
    newRootPath: "",
  },
};

export const AddingNew: Story = {
  args: {
    roots: [{ name: "Project Source", uri: "file:///home/user/project/src" }],
    newRootName: "Test Data",
    newRootPath: "/home/user/project/test-data",
  },
};

export const ManyRoots: Story = {
  args: {
    roots: [
      { name: "Source Code", uri: "file:///home/user/project/src" },
      { name: "Configuration", uri: "file:///home/user/project/config" },
      { name: "Documentation", uri: "file:///home/user/project/docs" },
      { name: "Test Fixtures", uri: "file:///home/user/project/test/fixtures" },
      { name: "Build Output", uri: "file:///home/user/project/dist" },
      { name: "Scripts", uri: "file:///home/user/project/scripts" },
    ],
    newRootName: "",
    newRootPath: "",
  },
};
