import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { InlineElicitationRequest } from "./InlineElicitationRequest";

const meta: Meta<typeof InlineElicitationRequest> = {
  title: "Groups/InlineElicitationRequest",
  component: InlineElicitationRequest,
  args: {
    message: "Please provide your database connection details.",
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
    mode: "form",
    schema: {
      type: "object",
      properties: {
        host: { type: "string", title: "Host" },
        port: { type: "integer", title: "Port" },
        database: { type: "string", title: "Database" },
      },
      required: ["host", "port"],
    },
    values: {},
  },
};

export const UrlMode: Story = {
  args: {
    mode: "url",
    url: "https://example.com/auth/callback?session=abc123",
    isWaiting: false,
  },
};

export const UrlWaiting: Story = {
  args: {
    mode: "url",
    url: "https://example.com/auth/callback?session=abc123",
    isWaiting: true,
  },
};
