import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ElicitRequest } from "@modelcontextprotocol/sdk/types.js";
import { fn } from "storybook/test";
import { InlineElicitationRequest } from "./InlineElicitationRequest";

const formRequest = {
  message: "Please provide your database connection details.",
  requestedSchema: {
    type: "object" as const,
    properties: {
      host: { type: "string" as const, title: "Host" },
      port: { type: "string" as const, title: "Port" },
      database: { type: "string" as const, title: "Database" },
    },
  },
} satisfies ElicitRequest["params"];

const urlRequest: ElicitRequest["params"] = {
  mode: "url",
  message: "Please authenticate via the external URL.",
  url: "https://example.com/auth/callback?session=abc123",
  elicitationId: "elicit-abc-123",
};

const meta: Meta<typeof InlineElicitationRequest> = {
  title: "Groups/InlineElicitationRequest",
  component: InlineElicitationRequest,
  args: {
    queuePosition: "1 of 1",
    onChange: fn(),
    onSubmit: fn(),
    onCancel: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof InlineElicitationRequest>;

export const FormMode: Story = {
  args: {
    request: formRequest,
    values: {},
  },
};

export const UrlMode: Story = {
  args: {
    request: urlRequest,
    isWaiting: false,
  },
};

export const UrlWaiting: Story = {
  args: {
    request: urlRequest,
    isWaiting: true,
  },
};
