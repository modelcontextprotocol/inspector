import type { Meta, StoryObj } from "@storybook/react-vite";
import { MessageBubble } from "./MessageBubble";

const meta: Meta<typeof MessageBubble> = {
  title: "Atoms/MessageBubble",
  component: MessageBubble,
};

export default meta;
type Story = StoryObj<typeof MessageBubble>;

export const UserText: Story = {
  args: {
    index: 0,
    role: "user",
    content: "Hello, my name is John and I like cats",
  },
};

export const AssistantText: Story = {
  args: {
    index: 1,
    role: "assistant",
    content:
      "Nice to meet you, John! It's wonderful that you enjoy cats. They're such fascinating and independent creatures. Do you have any cats of your own?",
  },
};

export const UserWithImage: Story = {
  args: {
    index: 0,
    role: "user",
    content: "Check this out",
    imageContent: {
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      mimeType: "image/png",
    },
  },
};

export const LongMessage: Story = {
  args: {
    index: 0,
    role: "user",
    content:
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum. Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo.",
  },
};
