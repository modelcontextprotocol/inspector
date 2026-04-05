import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ElicitationUrlPanel } from "./ElicitationUrlPanel";

const meta: Meta<typeof ElicitationUrlPanel> = {
  title: "Groups/ElicitationUrlPanel",
  component: ElicitationUrlPanel,
  args: {
    onCopyUrl: fn(),
    onOpenInBrowser: fn(),
    onCancel: fn(),
    message: "Please authenticate with the external service.",
    elicitationId: "elicit-abc-123",
  },
};

export default meta;
type Story = StoryObj<typeof ElicitationUrlPanel>;

export const Waiting: Story = {
  args: {
    url: "https://auth.example.com/oauth/authorize?client_id=mcp-inspector&redirect_uri=http://localhost:3000/callback",
    isWaiting: true,
  },
};

export const WithLongUrl: Story = {
  args: {
    url: "https://auth.example.com/oauth/authorize?client_id=mcp-inspector&redirect_uri=http://localhost:3000/callback&scope=read+write+admin&state=xyzzy-12345&nonce=abcdef-67890&response_type=code&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256",
    isWaiting: true,
  },
};

export const Completed: Story = {
  args: {
    url: "https://auth.example.com/oauth/authorize?client_id=mcp-inspector",
    isWaiting: false,
  },
};
