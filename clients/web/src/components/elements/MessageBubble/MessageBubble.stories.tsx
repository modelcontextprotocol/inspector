import type { Meta, StoryObj } from "@storybook/react-vite";
import { MessageBubble } from "./MessageBubble";

const meta: Meta<typeof MessageBubble> = {
  title: "Elements/MessageBubble",
  component: MessageBubble,
};

export default meta;
type Story = StoryObj<typeof MessageBubble>;

export const UserText: Story = {
  args: {
    index: 0,
    message: {
      role: "user",
      content: { type: "text", text: "Hello, my name is John and I like cats" },
    },
  },
};

export const AssistantText: Story = {
  args: {
    index: 1,
    message: {
      role: "assistant",
      content: {
        type: "text",
        text: "Nice to meet you, John! It's wonderful that you enjoy cats. They're such fascinating and independent creatures. Do you have any cats of your own?",
      },
    },
  },
};

export const UserWithImage: Story = {
  args: {
    index: 0,
    message: {
      role: "user",
      content: [
        { type: "text", text: "Check this out" },
        {
          type: "image",
          data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          mimeType: "image/png",
        },
      ],
    },
  },
};

export const LongMessage: Story = {
  args: {
    index: 0,
    message: {
      role: "user",
      content: {
        type: "text",
        text: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.",
      },
    },
  },
};
