import type { Meta, StoryObj } from "@storybook/react-vite";
import type { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { ElicitRequest } from "@modelcontextprotocol/client";
import { expect, fn, within } from "storybook/test";
import type { AppElicitationEntry } from "../../../lib/appElicitationController";
import type { BridgeFactory } from "../AppRenderer/AppRenderer";
import { AppElicitationHost } from "./AppElicitationHost";

const PLACEHOLDER_SANDBOX = "data:text/html,<title>Mock%20Sandbox</title>";

const params: ElicitRequest["params"] = {
  message: "Choose option A or B.",
  requestedSchema: {
    type: "object",
    properties: { choice: { type: "string", enum: ["option-a", "option-b"] } },
    required: ["choice"],
  },
};

function entry(
  requestId: string,
  resourceUri = "ui://demo/choose-option.html",
): AppElicitationEntry {
  return {
    requestId,
    resourceUri,
    params,
    signal: new AbortController().signal,
    resolve: fn(),
    reject: fn(),
  };
}

/**
 * Partial mock: implements only the `AppBridge` members the renderer touches,
 * plus the elicitation pair. The double cast bridges the deliberately
 * incomplete shape, as in the AppRenderer stories.
 */
function createMockBridge(): AppBridge {
  return {
    getAppCapabilities: () => ({ elicitation: {} }),
    request: async () => ({
      action: "accept",
      content: { choice: "option-a" },
    }),
    sendHostContextChange: async () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    teardownResource: async () => ({}),
    close: async () => {},
  } as unknown as AppBridge;
}

const okFactory: BridgeFactory = () => createMockBridge();

const failingFactory: BridgeFactory = () =>
  Promise.reject(new Error("Bridge connect failed: handshake timed out"));

const meta: Meta<typeof AppElicitationHost> = {
  title: "Elements/AppElicitationHost",
  component: AppElicitationHost,
  args: {
    sandboxPath: PLACEHOLDER_SANDBOX,
    bridgeFactory: okFactory,
    onSettle: fn(),
    onFail: fn(),
  },
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj<typeof AppElicitationHost>;

/** One server-attached app, waiting on the user inside the sandbox frame. */
export const SingleRequest: Story = {
  args: { entries: [entry("req-1")] },
  play: async ({ canvasElement }) => {
    // Modals portal to document.body, so scope to the whole document.
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByText("Choose option A or B.")).toBeVisible();
  },
};

/**
 * Two elicitations in flight at once, each with its own frame and bridge — the
 * request-scoped ownership the contract requires.
 */
export const ConcurrentRequests: Story = {
  args: {
    entries: [
      entry("req-1", "ui://demo/first.html"),
      entry("req-2", "ui://demo/second.html"),
    ],
  },
};

/** The app could not be brought up; the host falls back to the native form. */
export const RenderFailure: Story = {
  args: { entries: [entry("req-1")], bridgeFactory: failingFactory },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByText(/App failed to render/)).toBeVisible();
  },
};
