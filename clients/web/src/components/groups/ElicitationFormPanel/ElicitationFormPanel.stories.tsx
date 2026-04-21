import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ElicitRequestFormParams } from "@modelcontextprotocol/sdk/types.js";
import { fn } from "storybook/test";
import { ElicitationFormPanel } from "./ElicitationFormPanel";

const meta: Meta<typeof ElicitationFormPanel> = {
  title: "Groups/ElicitationFormPanel",
  component: ElicitationFormPanel,
  args: {
    onChange: fn(),
    onSubmit: fn(),
    onCancel: fn(),
    serverName: "postgres-server",
    values: {},
  },
};

export default meta;
type Story = StoryObj<typeof ElicitationFormPanel>;

const dbRequest = {
  message: "Please provide database connection details.",
  requestedSchema: {
    type: "object" as const,
    properties: {
      host: { type: "string" as const, title: "Host" },
      port: { type: "string" as const, title: "Port" },
      database: { type: "string" as const, title: "Database" },
    },
  },
} satisfies ElicitRequestFormParams;

const sslRequest = {
  message: "Please select your SSL mode preference.",
  requestedSchema: {
    type: "object" as const,
    properties: {
      sslMode: {
        type: "string" as const,
        title: "SSL Mode",
        enum: ["disable", "require", "verify-full"],
      },
    },
  },
} satisfies ElicitRequestFormParams;

const deployRequest = {
  message: "Please confirm the deployment.",
  requestedSchema: {
    type: "object" as const,
    properties: {
      environment: {
        type: "string" as const,
        title: "Environment",
        enum: ["staging", "production"],
      },
      confirm: { type: "boolean" as const, title: "Confirm deployment" },
    },
  },
} satisfies ElicitRequestFormParams;

export const SimpleForm: Story = {
  args: { request: dbRequest },
};

export const WithEnums: Story = {
  args: { request: sslRequest },
};

export const BooleanField: Story = {
  args: { request: deployRequest },
};
