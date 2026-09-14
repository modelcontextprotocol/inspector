import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import type { SecretStorageInfo } from "@inspector/core/auth/secret-storage-info.js";
import { SecretStorageFooter } from "./SecretStorageFooter";

const keyring: SecretStorageInfo = {
  kind: "keyring",
  reason: "default",
  durable: true,
};

const meta: Meta<typeof SecretStorageFooter> = {
  title: "Elements/SecretStorageFooter",
  component: SecretStorageFooter,
  args: { info: keyring },
};

export default meta;
type Story = StoryObj<typeof SecretStorageFooter>;

// The ordinary case on a desktop install: the OS keychain, stated quietly.
export const Keychain: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Asserted on the band's full text: the "Secrets:" prefix is its own
    // `<span>`, which a `findByText` string match would not see as one string.
    const band = await canvas.findByTestId("secret-storage-footer");
    await expect(band).toHaveTextContent("Secrets: OS keychain");
    await expect(band).toHaveAttribute("data-tone", "neutral");
  },
};

// A container with a mounted volume and `MCP_INSPECTOR_SECRET_KEY` set: durable,
// encrypted, and therefore still quiet — the path is the useful part.
export const EncryptedFile: Story = {
  args: {
    info: {
      kind: "file",
      reason: "fallback",
      durable: true,
      plaintext: false,
      path: "/home/node/.mcp-inspector/secrets.json",
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const band = await canvas.findByTestId("secret-storage-footer");
    await expect(band).toHaveTextContent(
      "Secrets: Encrypted file. Owner-only permissions.",
    );
    // The path is no longer printed on the band — it goes to the clipboard,
    // and stays readable in the button's accessible name.
    await expect(
      canvas.getByRole("button", {
        name: "Secrets: Encrypted file. Owner-only permissions. Copy secrets file path: /home/node/.mcp-inspector/secrets.json",
      }),
    ).toBeInTheDocument();
  },
};

// The same container without a passphrase. The caveat is rendered inline and in
// the warning tone — this is what "plaintext gets a loud banner" looks like at
// the point where the secret is actually typed.
export const UnencryptedFile: Story = {
  args: {
    info: {
      kind: "file",
      reason: "fallback",
      durable: true,
      plaintext: true,
      path: "/home/node/.mcp-inspector/secrets.json",
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const band = await canvas.findByTestId("secret-storage-footer");
    await expect(band).toHaveTextContent(
      "Secrets: Plaintext file. Owner-only permissions.",
    );
    await expect(band).toHaveAttribute("data-tone", "warn");
  },
};

// The published container with nothing mounted: session-scoped, and it says so
// rather than promising a durability the writable layer can't keep.
export const InMemory: Story = {
  args: { info: { kind: "memory", reason: "fallback", durable: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const band = await canvas.findByTestId("secret-storage-footer");
    await expect(band).toHaveTextContent(
      "Secrets: Memory (this session only):",
    );
    await expect(canvas.getByText(/lost on exit/)).toBeInTheDocument();
  },
};

// A backend that reports no store (legacy build): the band is absent entirely.
export const Unknown: Story = {
  args: { info: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId("secret-storage-footer")).toBeNull();
  },
};
