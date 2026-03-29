import type { Meta, StoryObj } from "@storybook/react-vite";
import { ContentViewer } from "./ContentViewer";

const meta: Meta<typeof ContentViewer> = {
  title: "Elements/ContentViewer",
  component: ContentViewer,
};

export default meta;
type Story = StoryObj<typeof ContentViewer>;

export const PlainText: Story = {
  args: {
    type: "text",
    content: "Hello, world!\nThis is plain text.",
  },
};

export const JsonContent: Story = {
  args: {
    type: "json",
    content:
      '{"name":"my-app","version":"1.0.0","description":"Sample configuration file"}',
  },
};

export const ImagePreview: Story = {
  args: {
    type: "image",
    content:
      "iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAABWUlEQVR4nO3YsQnAMAwAQe+/dLKCRZpD+UA6cVh8p/Oc81z9t1/eJ+/oD/ybVxDMKwjmFQTzCoJ5BcG8gmBeQTCvIJg3mLQX2eIVBPMKgnkFwbyCYF5BMK8gmFcQzCsI5hUE8zqdYF5BMK8gmFcQzCsI5hUE8wqCeQXBvIJgXkEwbzBpL7LFKwjmFQTzCoJ5BcG8gmBeQTCvIJhXEMwrCOZ1OsG8gmBeQTCvIJhXEMwrCOYVBPMKgnkFwbyCYN5g0l5ki1cQzCsI5hUE8wqCeQXBvIJgXkEwryCYVxDM63SCeQXBvIJgXkEwryCYVxDMKwjmFQTzCoJ5BcG8waS9yBavIJhXEMwrCOYVBPMKgnkFwbyCYF5BMK8gmNfpBPMKgnkFwbyCYF5BMK8gmFcQzCsI5hUE8wqCeYNJe5EtXkEwryCYVxDMKwjmFQTzCoJ5BcG8gmBeQTDvBaFNwZ0T5gfxAAAAAElFTkSuQmCC",
    mimeType: "image/png",
  },
};

export const LongContent: Story = {
  args: {
    type: "json",
    content: JSON.stringify({
      name: "my-app",
      version: "2.5.0",
      description: "A comprehensive application configuration",
      author: "Inspector Team",
      license: "MIT",
      repository: "https://github.com/example/my-app",
      dependencies: {
        react: "^18.0.0",
        typescript: "^5.0.0",
        mantine: "^7.0.0",
      },
      devDependencies: {
        vitest: "^1.0.0",
        storybook: "^8.0.0",
        eslint: "^9.0.0",
      },
      scripts: {
        dev: "vite",
        build: "tsc && vite build",
        test: "vitest",
        lint: "eslint .",
      },
      settings: {
        theme: "dark",
        language: "en",
        notifications: true,
        maxRetries: 3,
      },
    }),
  },
};

export const WithCopyButton: Story = {
  args: {
    type: "text",
    content: "Hello, world!\nThis text can be copied.",
    copyable: true,
  },
};

export const JsonWithCopy: Story = {
  args: {
    type: "json",
    content:
      '{"name":"my-app","version":"1.0.0","description":"Sample configuration file"}',
    copyable: true,
  },
};
