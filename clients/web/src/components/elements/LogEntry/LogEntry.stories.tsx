import type { Meta, StoryObj } from "@storybook/react-vite";
import { LogEntry } from "./LogEntry";

const meta: Meta<typeof LogEntry> = {
  title: "Elements/LogEntry",
  component: LogEntry,
};

export default meta;
type Story = StoryObj<typeof LogEntry>;

export const Debug: Story = {
  args: {
    entry: {
      receivedAt: new Date("2026-03-29T20:18:20.000Z"),
      params: { level: "debug", data: "Initializing connection pool" },
    },
  },
};

export const Info: Story = {
  args: {
    entry: {
      receivedAt: new Date("2026-03-29T20:18:21.000Z"),
      params: { level: "info", data: "Server started on port 3000" },
    },
  },
};

export const Warning: Story = {
  args: {
    entry: {
      receivedAt: new Date("2026-03-29T20:18:22.000Z"),
      params: {
        level: "warning",
        data: "Connection pool nearing capacity",
        logger: "pool",
      },
    },
  },
};

export const Error: Story = {
  args: {
    entry: {
      receivedAt: new Date("2026-03-29T20:18:23.000Z"),
      params: {
        level: "error",
        data: "Failed to connect to database",
        logger: "db",
      },
    },
  },
};

export const Emergency: Story = {
  args: {
    entry: {
      receivedAt: new Date("2026-03-29T20:18:24.000Z"),
      params: {
        level: "emergency",
        data: "System is unusable",
        logger: "kernel",
      },
    },
  },
};

export const WithJsonData: Story = {
  args: {
    entry: {
      receivedAt: new Date("2026-03-29T20:18:25.000Z"),
      params: {
        level: "info",
        data: { key: "value", count: 42 },
        logger: "api",
      },
    },
  },
};
