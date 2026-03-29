import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ResourceTemplateInput } from "./ResourceTemplateInput";

const meta: Meta<typeof ResourceTemplateInput> = {
  title: "Groups/ResourceTemplateInput",
  component: ResourceTemplateInput,
  args: {
    onVariableChange: fn(),
    onSubmit: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ResourceTemplateInput>;

export const SingleVariable: Story = {
  args: {
    template: "user/{id}",
    variables: {},
  },
};

export const MultipleVariables: Story = {
  args: {
    template: "org/{orgId}/user/{userId}",
    variables: {},
  },
};

export const FilledIn: Story = {
  args: {
    template: "org/{orgId}/user/{userId}",
    variables: {
      orgId: "acme-corp",
      userId: "user-42",
    },
  },
};
