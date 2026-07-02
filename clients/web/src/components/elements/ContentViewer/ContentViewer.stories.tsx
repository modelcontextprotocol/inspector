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
    block: { type: "text", text: "Hello, world!\nThis is plain text." },
  },
};

export const JsonContent: Story = {
  args: {
    block: {
      type: "text",
      text: '{"name":"my-app","version":"1.0.0","description":"Sample configuration file"}',
    },
  },
};

export const ImagePreview: Story = {
  args: {
    block: {
      type: "image",
      data: "iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAABWUlEQVR4nO3YsQnAMAwAQe+/dLKCRZpD+UA6cVh8p/Oc81z9t1/eJ+/oD/ybVxDMKwjmFQTzCoJ5BcG8gmBeQTCvIJg3mLQX2eIVBPMKgnkFwbyCYF5BMK8gmFcQzCsI5hUE8zqdYF5BMK8gmFcQzCsI5hUE8wqCeQXBvIJgXkEwbzBpL7LFKwjmFQTzCoJ5BcG8gmBeQTCvIJhXEMwrCOZ1OsG8gmBeQTCvIJhXEMwrCOYVBPMKgnkFwbyCYN5g0l5ki1cQzCsI5hUE8wqCeQXBvIJgXkEwryCYVxDM63SCeQXBvIJgXkEwryCYVxDMKwjmFQTzCoJ5BcG8waS9yBavIJhXEMwrCOYVBPMKgnkFwbyCYF5BMK8gmNfpBPMKgnkFwbyCYF5BMK8gmFcQzCsI5hUE8wqCeYNJe5EtXkEwryCYVxDMKwjmFQTzCoJ5BcG8gmBeQTDvBaFNwZ0T5gfxAAAAAElFTkSuQmCC",
      mimeType: "image/png",
    },
  },
};

export const LongJson: Story = {
  args: {
    block: {
      type: "text",
      text: JSON.stringify({
        name: "my-app",
        version: "2.5.0",
        description: "A comprehensive application configuration",
        dependencies: {
          react: "^18.0.0",
          typescript: "^5.0.0",
        },
        scripts: {
          dev: "vite",
          build: "tsc && vite build",
        },
      }),
    },
  },
};

export const WithCopyButton: Story = {
  args: {
    block: {
      type: "text",
      text: "Hello, world!\nThis text can be copied.",
    },
    copyable: true,
  },
};

export const JsonWithCopy: Story = {
  args: {
    block: {
      type: "text",
      text: '{"name":"my-app","version":"1.0.0","description":"Sample configuration file"}',
    },
    copyable: true,
  },
};

export const ResourceLinkBlock: Story = {
  args: {
    block: {
      type: "resource_link",
      uri: "file:///docs/readme.md",
      name: "Readme",
      description: "Project documentation",
      mimeType: "text/markdown",
    },
  },
};

// --- Resource contents (Resources screen) per-MIME dispatch -------------------

export const JsonHighlighted: Story = {
  args: {
    contents: {
      uri: "file:///config.json",
      mimeType: "application/json",
      text: '{"name":"my-app","version":"1.0.0","tags":["a","b"]}',
    },
    copyable: true,
  },
};

export const XmlHighlighted: Story = {
  args: {
    contents: {
      uri: "file:///feed.xml",
      mimeType: "application/xml",
      text: "<rss><channel><title>News</title><item>One</item></channel></rss>",
    },
    copyable: true,
  },
};

export const CssHighlighted: Story = {
  args: {
    contents: {
      uri: "file:///styles.css",
      mimeType: "text/css",
      text: ".card { color: var(--text); padding: 1rem; border-radius: 8px; }",
    },
    copyable: true,
  },
};

export const CsvTableContents: Story = {
  args: {
    contents: {
      uri: "file:///people.csv",
      mimeType: "text/csv",
      text: "name,role,city\nAlice,Engineer,Berlin\nBob,Designer,Lisbon\nCarol,PM,Oslo",
    },
  },
};

export const HtmlSandboxed: Story = {
  args: {
    contents: {
      uri: "file:///report.html",
      mimeType: "text/html",
      text: "<h1>Report</h1><p>This renders in a <strong>sandboxed</strong> iframe.</p>",
    },
  },
};

export const BinaryUnsupported: Story = {
  args: {
    contents: {
      uri: "file:///archive.zip",
      mimeType: "application/zip",
      blob: "UEsDBAoAAAAAAA==",
    },
  },
};
