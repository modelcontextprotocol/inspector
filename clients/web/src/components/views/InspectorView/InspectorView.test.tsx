import { describe, it, expect, vi, afterEach } from "vitest";
import userEvent from "@testing-library/user-event";
import type { ServerEntry } from "@inspector/core/mcp/types.js";
import {
  renderWithMantine,
  screen,
  waitFor,
} from "../../../test/renderWithMantine";
import { InspectorView } from "./InspectorView";

const baseProps = {
  servers: [],
  tools: [],
  prompts: [],
  resources: [],
  resourceTemplates: [],
  subscriptions: [],
  logs: [],
  tasks: [],
  history: [],
  onToggleTheme: vi.fn(),
};

const sampleServer: ServerEntry = {
  id: "alpha",
  name: "Alpha",
  config: { type: "stdio", command: "echo" },
  connection: { status: "disconnected" },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("InspectorView", () => {
  it("renders the disconnected header by default", () => {
    renderWithMantine(<InspectorView {...baseProps} />);
    expect(
      screen.getByText("No servers configured. Add a server to get started."),
    ).toBeInTheDocument();
  });

  it("renders the server card from the input list", () => {
    renderWithMantine(
      <InspectorView {...baseProps} servers={[sampleServer]} />,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });

  it("transitions to connected on a successful handshake", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    const user = userEvent.setup();
    renderWithMantine(
      <InspectorView {...baseProps} servers={[sampleServer]} />,
    );
    await user.click(screen.getByRole("switch"));
    await waitFor(
      () => {
        expect(
          screen.queryByText(
            "No servers configured. Add a server to get started.",
          ),
        ).not.toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });

  it("transitions to error on a failed handshake", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const user = userEvent.setup();
    renderWithMantine(
      <InspectorView {...baseProps} servers={[sampleServer]} />,
    );
    await user.click(screen.getByRole("switch"));
    await waitFor(
      () => {
        expect(
          screen.getByText("Server returned invalid response"),
        ).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });

  it("disconnects when the connected server is toggled off", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    const user = userEvent.setup();
    renderWithMantine(
      <InspectorView {...baseProps} servers={[sampleServer]} />,
    );
    const toggle = screen.getByRole("switch");
    await user.click(toggle);
    await waitFor(
      () => {
        expect(toggle).toBeChecked();
        expect(toggle).not.toBeDisabled();
      },
      { timeout: 2000 },
    );
    await user.click(toggle);
    expect(toggle).not.toBeChecked();
  });

  it("renders ViewHeader connected when handshake succeeds", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    const user = userEvent.setup();
    renderWithMantine(
      <InspectorView {...baseProps} servers={[sampleServer]} />,
    );
    const toggle = screen.getByRole("switch");
    await user.click(toggle);
    await waitFor(
      () => {
        expect(toggle).toBeChecked();
        expect(toggle).not.toBeDisabled();
      },
      { timeout: 2000 },
    );
    expect(screen.getAllByText("Alpha").length).toBeGreaterThan(0);
  });

  it("toggles autoScroll on the Logs screen after connecting", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    const user = userEvent.setup();
    renderWithMantine(
      <InspectorView {...baseProps} servers={[sampleServer]} />,
    );
    const toggle = screen.getByRole("switch");
    await user.click(toggle);
    await waitFor(
      () => {
        expect(toggle).toBeChecked();
        expect(toggle).not.toBeDisabled();
      },
      { timeout: 2000 },
    );
    // Switch to Logs via the header Select. Mantine renders options into a
    // hidden portal in happy-dom — find via getAllByText with hidden traversal.
    const tabSelect = await screen.findByDisplayValue("Servers");
    await user.click(tabSelect);
    const logsOption = await screen.findByText("Logs");
    await user.click(logsOption);
    const autoScroll = await screen.findByRole("checkbox", {
      name: "Auto-scroll",
    });
    expect(autoScroll).toBeChecked();
    await user.click(autoScroll);
    expect(autoScroll).not.toBeChecked();
  });
});
