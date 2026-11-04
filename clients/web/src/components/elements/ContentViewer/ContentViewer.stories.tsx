import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";
import { ContentViewer } from "./ContentViewer";
import { PREVIEW_HTML_CSP, wrapHtmlWithCsp } from "./contentViewerUtils";

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

// A full document whose first `<head>` is inside a comment — the shape that
// once pulled the preview CSP into the comment. Parsing the wrapped document
// in the play function is deliberate: the iframe is `sandbox=""` (an opaque
// origin the story cannot inspect), and happy-dom's parser does not place a
// leading `<meta>` the way the HTML spec does, so only a real browser can
// assert where the policy actually lands.
const COMMENTED_HEAD_HTML =
  '<!-- <head> --><html lang="en"><head><title>Report</title></head><body><h1>Report</h1></body></html>';

export const HtmlCommentedHead: Story = {
  args: {
    contents: {
      uri: "file:///commented-head.html",
      mimeType: "text/html",
      text: COMMENTED_HEAD_HTML,
    },
  },
  play: async () => {
    const doc = new DOMParser().parseFromString(
      wrapHtmlWithCsp(COMMENTED_HEAD_HTML),
      "text/html",
    );
    const csp = doc.head.querySelector(
      'meta[http-equiv="Content-Security-Policy"]',
    );
    await expect(csp).not.toBeNull();
    // Nothing from the document precedes the policy in the head.
    await expect(doc.head.firstElementChild).toBe(csp);
    await expect(doc.title).toBe("Report");
    await expect(doc.documentElement.getAttribute("lang")).toBe("en");
    await expect(doc.body.textContent).toBe("Report");
  },
};

// A doctype whose quoted SYSTEM / PUBLIC identifier contains `>`. Only the
// simple `<!DOCTYPE html>` is kept ahead of the policy, so the meta goes first
// here and must still be the head's first element, ahead of the image, however
// the parser tokenizes the identifier. Parsed in the play function for the
// same reason as `HtmlCommentedHead`.
const QUOTED_SYSTEM_DOCTYPE_HTML =
  '<!DOCTYPE html SYSTEM "x>"><img src="https://example.com/pixel">';
const QUOTED_PUBLIC_DOCTYPE_HTML =
  '<!DOCTYPE html PUBLIC "a>" "b>"><img src="https://example.com/pixel">';

async function expectPolicyAheadOfImage(html: string) {
  const doc = new DOMParser().parseFromString(
    wrapHtmlWithCsp(html),
    "text/html",
  );
  const csp = doc.head.querySelector(
    'meta[http-equiv="Content-Security-Policy"]',
  );
  await expect(csp).not.toBeNull();
  await expect(doc.head.firstElementChild).toBe(csp);
  await expect(csp?.getAttribute("content")).toBe(PREVIEW_HTML_CSP);
  // The image is a real element after the policy, not doctype text.
  await expect(doc.body.querySelector("img")).not.toBeNull();
}

export const HtmlDoctypeQuotedSystem: Story = {
  args: {
    contents: {
      uri: "file:///doctype-system.html",
      mimeType: "text/html",
      text: QUOTED_SYSTEM_DOCTYPE_HTML,
    },
  },
  play: async () => {
    await expectPolicyAheadOfImage(QUOTED_SYSTEM_DOCTYPE_HTML);
  },
};

export const HtmlDoctypeQuotedPublic: Story = {
  args: {
    contents: {
      uri: "file:///doctype-public.html",
      mimeType: "text/html",
      text: QUOTED_PUBLIC_DOCTYPE_HTML,
    },
  },
  play: async () => {
    await expectPolicyAheadOfImage(QUOTED_PUBLIC_DOCTYPE_HTML);
  },
};

// U+00A0 ahead of a doctype is text, not HTML whitespace, so it opens the body:
// a meta written after that doctype would land in the body, where a CSP meta
// is not applied. Only HTML whitespace may precede a doctype kept first.
const NBSP_DOCTYPE_HTML =
  '\u00A0<!DOCTYPE html><img src="https://example.com/pixel">';

export const HtmlDoctypeAfterNbsp: Story = {
  args: {
    contents: {
      uri: "file:///doctype-nbsp.html",
      mimeType: "text/html",
      text: NBSP_DOCTYPE_HTML,
    },
  },
  play: async () => {
    await expectPolicyAheadOfImage(NBSP_DOCTYPE_HTML);
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
