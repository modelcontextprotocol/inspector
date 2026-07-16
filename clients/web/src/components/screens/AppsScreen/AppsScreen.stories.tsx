import { useCallback, useRef, useState } from "react";
import { Stack, Text } from "@mantine/core";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CallToolResult, Tool } from "@modelcontextprotocol/client";
import type { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import {
  AppsScreen,
  type AppsScreenProps,
  type AppsUiState,
} from "./AppsScreen";
import { EMPTY_APPS_UI } from "../screenUiState";
import type {
  AppRendererHandle,
  BridgeFactory,
} from "../../elements/AppRenderer/AppRenderer";
import { SUN_ICON_SVG } from "../../../test/fixtures/storyIcons";

// A self-contained, themed sandbox page so the running-state stories show
// visible content in both light and dark mode (Canvas / CanvasText are CSS
// system colors that follow `color-scheme`), instead of a blank/white frame.
const PLACEHOLDER_SANDBOX =
  "data:text/html," +
  encodeURIComponent(
    `<!doctype html><html><head><meta name="color-scheme" content="light dark">` +
      `<style>html,body{height:100%;margin:0}` +
      `body{display:flex;align-items:center;justify-content:center;` +
      `font-family:system-ui,sans-serif;color:CanvasText;background:Canvas}</style>` +
      `</head><body><div>Mock app — running in sandbox</div></body></html>`,
  );

function createMockBridge(): AppBridge {
  return {
    sendToolInput: async () => {},
    sendToolResult: async () => {},
    sendToolCancelled: async () => {},
    sendHostContextChange: async () => {},
    teardownResource: async () => ({}),
    close: async () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as AppBridge;
}

const okBridgeFactory: BridgeFactory = () => createMockBridge();

const cohortApp: Tool = {
  name: "get-cohort-data",
  title: "Cohort Data",
  description: "Returns cohort retention heatmap data.",
  inputSchema: {
    type: "object",
    properties: {
      metric: { type: "string", description: "retention | engagement" },
      periodType: { type: "string", description: "daily | weekly | monthly" },
      cohortCount: { type: "number", description: "Cohorts to render" },
      maxPeriods: { type: "number", description: "Periods per cohort" },
    },
    required: ["metric", "periodType"],
  },
  _meta: { ui: { resourceUri: "ui://apps/cohort-heatmap" } },
};

const weatherApp: Tool = {
  name: "weather-widget",
  title: "Weather Widget",
  description: "Live weather and a five-day forecast for any city.",
  icons: [{ src: SUN_ICON_SVG, mimeType: "image/svg+xml" }],
  inputSchema: {
    type: "object",
    properties: {
      city: { type: "string", description: "City name" },
    },
    required: ["city"],
  },
  _meta: { ui: { resourceUri: "ui://apps/weather" } },
};

const dashboardApp: Tool = {
  name: "ops-dashboard",
  title: "Ops Dashboard",
  description: "Current operational status across services.",
  inputSchema: { type: "object" },
  _meta: { ui: { resourceUri: "ui://apps/ops" } },
};

const sampleApps: Tool[] = [cohortApp, weatherApp, dashboardApp];

// AppsScreen is controlled (app selection, form values, and search text live in
// the parent as one `ui` object — running/maximized stay internal; see #1417).
// This hook holds the lifted state so the play-driven select/type/open
// interactions still drive the detail panel, mirroring how App owns the state in
// the real app.
function useLiftedAppState(args: AppsScreenProps) {
  const [ui, setUi] = useState<AppsUiState>(args.ui ?? EMPTY_APPS_UI);
  return { ui, onUiChange: setUi };
}

const meta: Meta<typeof AppsScreen> = {
  title: "Screens/AppsScreen",
  component: AppsScreen,
  parameters: { layout: "fullscreen" },
  args: {
    sandboxPath: PLACEHOLDER_SANDBOX,
    bridgeFactory: okBridgeFactory,
    listChanged: false,
    ui: EMPTY_APPS_UI,
    onUiChange: fn(),
    onRefreshList: fn(),
    onSelectApp: fn(),
    onOpenApp: fn(),
    onCloseApp: fn(),
  },
  // Each story uses its own ref so AppRenderer's imperative handle gets a
  // fresh slot per render (Storybook may keep the canvas mounted across
  // arg edits, but the ref itself is owned by the wrapping component).
  render: function StoryRender(args: AppsScreenProps) {
    const ref = useRef<AppRendererHandle>(null);
    const lifted = useLiftedAppState(args);
    return <AppsScreen {...args} {...lifted} rendererRef={ref} />;
  },
};

export default meta;
type Story = StoryObj<typeof AppsScreen>;

async function selectByLabel(canvasElement: HTMLElement, label: string) {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByText(label));
}

async function clickByName(canvasElement: HTMLElement, name: RegExp) {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole("button", { name }));
}

export const NoSelection: Story = {
  args: { tools: sampleApps },
};

export const AppSelected: Story = {
  args: { tools: sampleApps },
  play: async ({ canvasElement }) => {
    await selectByLabel(canvasElement, "Cohort Data");
  },
};

export const AppRunning: Story = {
  args: { tools: sampleApps },
  play: async ({ canvasElement }) => {
    await selectByLabel(canvasElement, "Weather Widget");
    const canvas = within(canvasElement);
    const cityField = await canvas.findByRole("textbox", { name: /city/i });
    await userEvent.type(cityField, "Reykjavik");
    await clickByName(canvasElement, /open app/i);
  },
};

export const AppRunningMaximized: Story = {
  args: { tools: sampleApps },
  play: async ({ canvasElement }) => {
    await selectByLabel(canvasElement, "Weather Widget");
    const canvas = within(canvasElement);
    const cityField = await canvas.findByRole("textbox", { name: /city/i });
    await userEvent.type(cityField, "Reykjavik");
    await clickByName(canvasElement, /open app/i);
    await userEvent.click(await canvas.findByLabelText("Maximize"));
  },
};

export const NoFieldsApp: Story = {
  args: { tools: sampleApps },
  play: async ({ canvasElement }) => {
    await selectByLabel(canvasElement, "Ops Dashboard");
  },
};

export const WithListChanged: Story = {
  args: { tools: sampleApps, listChanged: true },
};

export const Empty: Story = {
  args: { tools: [] },
};

// Drives the real running-state interaction with a fake bridge that echoes
// tool input straight back as a tool result. Because the mock sandbox page
// never completes the real handshake, the factory synthesizes the view's
// `initialized` signal so AppRenderer flushes the buffered input. The echoed
// result is surfaced in a status line so the round-trip is observable in
// `npm run test:storybook`.
export const EchoRunning: Story = {
  args: { tools: [weatherApp] },
  render: function EchoRender(args: AppsScreenProps) {
    const ref = useRef<AppRendererHandle>(null);
    const [echo, setEcho] = useState<string | null>(null);
    const lifted = useLiftedAppState(args);

    const bridgeFactory: BridgeFactory = useCallback(() => {
      let onInitialized: (() => void) | undefined;
      const bridge = {
        addEventListener: (event: string, handler: () => void) => {
          if (event === "initialized") onInitialized = handler;
        },
        removeEventListener: () => {},
        sendToolInput: async (params: {
          arguments?: Record<string, unknown>;
        }) => {
          // Echo the input back as a result.
          await bridge.sendToolResult({
            content: [
              {
                type: "text",
                text: `echo: ${JSON.stringify(params.arguments)}`,
              },
            ],
          });
        },
        sendToolResult: async (result: CallToolResult) => {
          const first = result.content[0];
          setEcho(first?.type === "text" ? first.text : "");
        },
        sendToolCancelled: async () => {},
        sendHostContextChange: async () => {},
        teardownResource: async () => ({}),
        close: async () => {},
      };
      // Simulate the view finishing initialization shortly after AppRenderer
      // registers its `initialized` listener; sendToolInput then flushes.
      setTimeout(() => onInitialized?.(), 20);
      return bridge as unknown as AppBridge;
    }, []);

    const onOpenApp = useCallback(
      (_name: string, formArgs: Record<string, unknown>) => {
        // Mirror App.tsx: defer one microtask so the renderer's imperative
        // handle (set during the commit's layout phase) is wired before
        // pushing input. The renderer buffers it until the view initializes.
        void Promise.resolve().then(() => ref.current?.sendToolInput(formArgs));
      },
      [],
    );

    return (
      <Stack gap={0}>
        <Text data-testid="echo-status" p="xs">
          {echo ?? "no echo yet"}
        </Text>
        <AppsScreen
          {...args}
          {...lifted}
          rendererRef={ref}
          bridgeFactory={bridgeFactory}
          onOpenApp={onOpenApp}
        />
      </Stack>
    );
  },
  play: async ({ canvasElement }) => {
    await selectByLabel(canvasElement, "Weather Widget");
    const canvas = within(canvasElement);
    const cityField = await canvas.findByRole("textbox", { name: /city/i });
    await userEvent.type(cityField, "Oslo");
    await clickByName(canvasElement, /open app/i);
    await waitFor(() =>
      expect(canvas.getByTestId("echo-status")).toHaveTextContent(/echo:/),
    );
  },
};

// No sandbox URL available — the screen renders an unavailable state rather
// than a blank iframe.
export const Unavailable: Story = {
  args: { tools: sampleApps, sandboxPath: undefined },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText(/MCP Apps are unavailable/i);
  },
};
