import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ResourceTemplatePanel } from "./ResourceTemplatePanel";

const meta: Meta<typeof ResourceTemplatePanel> = {
  title: "Groups/ResourceTemplatePanel",
  component: ResourceTemplatePanel,
  args: {
    onReadResource: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ResourceTemplatePanel>;

export const SingleVariable: Story = {
  args: {
    template: {
      name: "User Profile",
      uriTemplate: "file:///users/{userId}/profile",
      description: "Fetch a user profile by their unique identifier.",
    },
  },
};

export const MultipleVariables: Story = {
  args: {
    template: {
      name: "Table Row",
      title: "Database Table Row",
      uriTemplate: "db://tables/{tableName}/rows/{rowId}",
      description: "Access a specific row in a database table.",
    },
  },
};

export const WithAnnotations: Story = {
  args: {
    template: {
      name: "Dynamic Text Resource",
      uriTemplate: "resource://dynamic/{resourceId}",
      description:
        "Plaintext dynamic resource fabricated from the {resourceId} variable, which must be an integer.",
      annotations: { audience: ["user"], priority: 0.8 },
    },
  },
};

export const NoDescription: Story = {
  args: {
    template: {
      name: "Simple Template",
      uriTemplate: "file:///data/{filename}",
    },
  },
};
