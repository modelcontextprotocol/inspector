import type { Meta, StoryObj } from "@storybook/react-vite";
import type { Task } from "@modelcontextprotocol/client";
import { fn } from "storybook/test";
import { TaskListPanel } from "./TaskListPanel";
import { expectNoHorizontalOverflow } from "../../../test/scrollAreaStoryAssertions";
import { narrowSidebarDecorator } from "../../../test/narrowSidebarDecorator";

const sampleTasks: Task[] = [
  {
    taskId: "d0b22eba71fa36229ce5c4dfadeaa7de",
    status: "working",
    ttl: 300000,
    createdAt: "2026-03-29T20:18:20Z",
    lastUpdatedAt: "2026-03-29T20:18:22Z",
    statusMessage: "Synthesizing findings...",
  },
  {
    taskId: "4100b5e0b0ed9cd0023330342d1bf647",
    status: "input_required",
    ttl: 300000,
    createdAt: "2026-03-29T20:17:55Z",
    lastUpdatedAt: "2026-03-29T20:17:55Z",
  },
  {
    taskId: "d487b49aa39023d907b5a2a5b506cb3",
    status: "completed",
    ttl: 300000,
    createdAt: "2026-03-29T20:16:47Z",
    lastUpdatedAt: "2026-03-29T20:16:51Z",
    statusMessage: "Report generated successfully",
  },
  {
    taskId: "e6ebffd9cca84ddd1646d3c579a4d453",
    status: "failed",
    ttl: 300000,
    createdAt: "2026-03-29T20:17:27Z",
    lastUpdatedAt: "2026-03-29T20:17:28Z",
    statusMessage: "Connection refused: upstream server not responding",
  },
];

const meta: Meta<typeof TaskListPanel> = {
  title: "Groups/TaskListPanel",
  component: TaskListPanel,
  args: {
    tasks: sampleTasks,
    searchText: "",
    onCancel: fn(),
    onClearCompleted: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof TaskListPanel>;

export const Default: Story = {};

export const FilteredByStatus: Story = {
  args: {
    statusFilter: "working",
  },
};

export const WithSearch: Story = {
  args: {
    searchText: "generate",
  },
};

export const Empty: Story = {
  args: {
    tasks: [],
  },
};

// A long task id and an unbroken status message in the sidebar must truncate
// or wrap inside the card, never widen the list (#2675).
export const EmbeddedLongContent: Story = {
  args: {
    embedded: true,
    tasks: [
      {
        taskId:
          "d0b22eba71fa36229ce5c4dfadeaa7ded0b22eba71fa36229ce5c4dfadeaa7de",
        status: "working",
        ttl: 300000,
        createdAt: "2026-03-29T20:18:20Z",
        lastUpdatedAt: "2026-03-29T20:18:22Z",
        statusMessage:
          "Reading demo://resource/minted/c05df264-ed9c-44a4-a81d-c2d7f3b9e1a0/gzip-file-as-resource/compressed-payload.gz",
      },
      sampleTasks[2],
    ],
  },
  decorators: [narrowSidebarDecorator],
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement);
  },
};
