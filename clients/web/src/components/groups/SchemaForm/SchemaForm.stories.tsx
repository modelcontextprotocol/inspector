import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { SchemaForm } from "./SchemaForm";

const meta: Meta<typeof SchemaForm> = {
  title: "Groups/SchemaForm",
  component: SchemaForm,
  args: {
    onChange: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof SchemaForm>;

export const StringFields: Story = {
  args: {
    schema: {
      type: "object",
      properties: {
        name: { type: "string", title: "Name" },
        description: { type: "string", title: "Description" },
      },
      required: ["name"],
    },
    values: {},
  },
};

export const NumberFields: Story = {
  args: {
    schema: {
      type: "object",
      properties: {
        age: { type: "integer", title: "Age", minimum: 0, maximum: 150 },
        price: { type: "number", title: "Price", minimum: 0 },
      },
    },
    values: {},
  },
};

export const BooleanFields: Story = {
  args: {
    schema: {
      type: "object",
      properties: {
        enabled: { type: "boolean", title: "Enabled" },
        verbose: { type: "boolean", title: "Verbose" },
      },
    },
    values: {},
  },
};

export const EnumDropdown: Story = {
  args: {
    schema: {
      type: "object",
      properties: {
        format: {
          type: "string",
          title: "Format",
          enum: ["json", "csv", "xml"],
        },
      },
    },
    values: {},
  },
};

export const TitledEnum: Story = {
  args: {
    schema: {
      type: "object",
      properties: {
        size: {
          type: "string",
          title: "Size",
          oneOf: [
            { const: "small", title: "Small (1-10)" },
            { const: "medium", title: "Medium (11-100)" },
            { const: "large", title: "Large (100+)" },
          ],
        },
      },
    },
    values: {},
  },
};

export const MixedTypes: Story = {
  args: {
    schema: {
      type: "object",
      properties: {
        name: { type: "string", title: "Name" },
        count: { type: "number", title: "Count" },
        active: { type: "boolean", title: "Active" },
        color: {
          type: "string",
          title: "Color",
          enum: ["red", "green", "blue"],
        },
      },
    },
    values: {},
  },
};

export const WithDefaults: Story = {
  args: {
    schema: {
      type: "object",
      properties: {
        name: { type: "string", title: "Name", default: "John Doe" },
        count: { type: "number", title: "Count", default: 42 },
        active: { type: "boolean", title: "Active", default: true },
        format: {
          type: "string",
          title: "Format",
          enum: ["json", "csv", "xml"],
          default: "json",
        },
      },
    },
    values: {},
  },
};

export const WithDescriptions: Story = {
  args: {
    schema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          title: "Name",
          description: "Enter your full name as it appears on your ID",
        },
        email: {
          type: "string",
          title: "Email",
          description: "A valid email address for notifications",
        },
        age: {
          type: "integer",
          title: "Age",
          description: "Your age in years",
          minimum: 0,
          maximum: 150,
        },
      },
    },
    values: {},
  },
};

export const Disabled: Story = {
  args: {
    schema: {
      type: "object",
      properties: {
        name: { type: "string", title: "Name" },
        count: { type: "number", title: "Count" },
        active: { type: "boolean", title: "Active" },
        color: {
          type: "string",
          title: "Color",
          enum: ["red", "green", "blue"],
        },
      },
    },
    values: {
      name: "Example",
      count: 10,
      active: true,
      color: "green",
    },
    disabled: true,
  },
};
