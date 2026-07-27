import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ReAuthBanner } from "./ReAuthBanner";
import {
  lostAuthorizationStateActionLabel,
  lostAuthorizationStateMessage,
  lostAuthorizationStateTitle,
  reAuthBannerMessage,
} from "../../../utils/oauthUx";

const meta: Meta<typeof ReAuthBanner> = {
  title: "Groups/ReAuthBanner",
  component: ReAuthBanner,
  args: {
    onReauthenticate: fn(),
    onDismiss: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof ReAuthBanner>;

/** Degraded session: the stored token no longer works. */
export const SessionNeedsAttention: Story = {
  args: {
    message: reAuthBannerMessage({
      serverName: "PlotRocket",
      detail: "Token expired.",
    }),
  },
};

/**
 * SEP-2352 callback leg arrived with no recorded discovery state (#1808).
 * Explains the loss in plain language and offers a one-click fresh
 * authorization (which clears the stale state first).
 */
export const AuthorizationStateLost: Story = {
  args: {
    title: lostAuthorizationStateTitle(),
    actionLabel: lostAuthorizationStateActionLabel(),
    message: lostAuthorizationStateMessage({ serverName: "PlotRocket" }),
  },
};
