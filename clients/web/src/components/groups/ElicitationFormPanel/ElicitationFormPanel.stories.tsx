import type { Meta, StoryObj } from "@storybook/react-vite";
import { Flex } from "@mantine/core";
import type { ElicitRequestFormParams } from "@modelcontextprotocol/sdk/types.js";
import { fn } from "storybook/test";
import { ElicitationFormPanel } from "./ElicitationFormPanel";

const meta: Meta<typeof ElicitationFormPanel> = {
  title: "Groups/ElicitationFormPanel",
  component: ElicitationFormPanel,
  args: {
    onChange: fn(),
    onSubmit: fn(),
    onDecline: fn(),
    onCancel: fn(),
    serverName: "postgres-server",
    values: {},
  },
  // The panel fills a bounded flex column (its host `PendingClientRequestModal`
  // makes the modal body one). Mirror that here so the pinned-actions layout —
  // fields scroll, buttons stay put — renders as it does in the modal.
  decorators: [
    (Story) => (
      <Flex h="80vh" maw={560} direction="column">
        <Story />
      </Flex>
    ),
  ],
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

// A form with more fields than fit the modal, to exercise the pinned-actions
// layout: the fields scroll while the message and Cancel/Decline/Submit stay
// in view.
const manyFieldsRequest = {
  message: "Please provide the full server configuration.",
  requestedSchema: {
    type: "object" as const,
    properties: Object.fromEntries(
      [
        "host",
        "port",
        "database",
        "username",
        "password",
        "schema",
        "poolSize",
        "connectTimeout",
        "idleTimeout",
        "applicationName",
        "sslCert",
        "sslKey",
      ].map((name) => [name, { type: "string" as const, title: name }]),
    ),
  },
} satisfies ElicitRequestFormParams;

export const SimpleForm: Story = {
  args: { request: dbRequest },
};

export const ManyFields: Story = {
  args: { request: manyFieldsRequest },
};

export const WithEnums: Story = {
  args: { request: sslRequest },
};

export const BooleanField: Story = {
  args: { request: deployRequest },
};
