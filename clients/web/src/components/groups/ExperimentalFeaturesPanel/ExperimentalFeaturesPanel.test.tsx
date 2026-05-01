import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ExperimentalFeaturesPanel } from "./ExperimentalFeaturesPanel";
import type { RequestHistoryItem } from "./ExperimentalFeaturesPanel";

const baseProps = {
  serverExperimental: undefined,
  clientExperimental: undefined,
  requestDraft:
    '{"jsonrpc":"2.0","id":1,"method":"experimental/x","params":{}}',
  customHeaders: [],
  requestHistory: [],
  onToggleClientCapability: vi.fn(),
  onRequestChange: vi.fn(),
  onSendRequest: vi.fn(),
  onAddHeader: vi.fn(),
  onRemoveHeader: vi.fn(),
  onHeaderChange: vi.fn(),
  onCopyResponse: vi.fn(),
  onTestCapability: vi.fn(),
};

describe("ExperimentalFeaturesPanel", () => {
  it("renders the warning alert and section titles", () => {
    renderWithMantine(<ExperimentalFeaturesPanel {...baseProps} />);
    expect(
      screen.getByText(
        "These features are non-standard and may change or be removed.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Server Experimental Capabilities:"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Client Experimental Capabilities:"),
    ).toBeInTheDocument();
    expect(screen.getByText("Advanced JSON-RPC Tester")).toBeInTheDocument();
  });

  it("shows the empty state when no server experimental capabilities are present", () => {
    renderWithMantine(<ExperimentalFeaturesPanel {...baseProps} />);
    expect(
      screen.getByText("No experimental capabilities"),
    ).toBeInTheDocument();
  });

  it("renders server capability cards with description and methods", () => {
    renderWithMantine(
      <ExperimentalFeaturesPanel
        {...baseProps}
        serverExperimental={{
          "experimental/streaming": {
            description: "Supports streaming responses",
            methods: [
              "experimental/stream.start",
              "experimental/stream.cancel",
            ],
          },
        }}
      />,
    );
    expect(screen.getByText("experimental/streaming")).toBeInTheDocument();
    expect(
      screen.getByText("Supports streaming responses"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Methods: experimental/stream.start, experimental/stream.cancel",
      ),
    ).toBeInTheDocument();
  });

  it("renders the capability card without description or methods when not provided", () => {
    renderWithMantine(
      <ExperimentalFeaturesPanel
        {...baseProps}
        serverExperimental={{
          "experimental/bare": {},
        }}
      />,
    );
    expect(screen.getByText("experimental/bare")).toBeInTheDocument();
    expect(screen.queryByText(/^Methods:/)).not.toBeInTheDocument();
  });

  it("invokes onTestCapability when Test is clicked on a capability card", async () => {
    const user = userEvent.setup();
    const onTestCapability = vi.fn();
    renderWithMantine(
      <ExperimentalFeaturesPanel
        {...baseProps}
        onTestCapability={onTestCapability}
        serverExperimental={{
          "experimental/echo": { description: "Echoes" },
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Test/ }));
    expect(onTestCapability).toHaveBeenCalledWith("experimental/echo");
  });

  it("renders the known client capability toggles with their friendly labels", () => {
    renderWithMantine(<ExperimentalFeaturesPanel {...baseProps} />);
    expect(
      screen.getByRole("checkbox", { name: "Custom sampling" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Batch requests" }),
    ).toBeInTheDocument();
  });

  it("marks a known client capability checkbox as checked when enabled", () => {
    renderWithMantine(
      <ExperimentalFeaturesPanel
        {...baseProps}
        clientExperimental={{ "experimental/batchRequests": {} }}
      />,
    );
    const sampling = screen.getByRole("checkbox", {
      name: "Custom sampling",
    }) as HTMLInputElement;
    const batch = screen.getByRole("checkbox", {
      name: "Batch requests",
    }) as HTMLInputElement;
    expect(sampling.checked).toBe(false);
    expect(batch.checked).toBe(true);
  });

  it("renders unknown client capabilities by their key", () => {
    renderWithMantine(
      <ExperimentalFeaturesPanel
        {...baseProps}
        clientExperimental={{
          "experimental/customSampling": {},
          "experimental/futureFeatureXyz": {},
        }}
      />,
    );
    expect(
      screen.getByRole("checkbox", { name: "experimental/futureFeatureXyz" }),
    ).toBeInTheDocument();
  });

  it("invokes onToggleClientCapability when a client checkbox is clicked", async () => {
    const user = userEvent.setup();
    const onToggleClientCapability = vi.fn();
    renderWithMantine(
      <ExperimentalFeaturesPanel
        {...baseProps}
        onToggleClientCapability={onToggleClientCapability}
      />,
    );
    await user.click(screen.getByRole("checkbox", { name: "Custom sampling" }));
    expect(onToggleClientCapability).toHaveBeenCalledWith(
      "experimental/customSampling",
      true,
    );
  });

  it("invokes onAddHeader when + Add Header is clicked", async () => {
    const user = userEvent.setup();
    const onAddHeader = vi.fn();
    renderWithMantine(
      <ExperimentalFeaturesPanel {...baseProps} onAddHeader={onAddHeader} />,
    );
    await user.click(screen.getByRole("button", { name: "+ Add Header" }));
    expect(onAddHeader).toHaveBeenCalledTimes(1);
  });

  it("renders custom header rows and invokes onHeaderChange when key changes", async () => {
    const user = userEvent.setup();
    const onHeaderChange = vi.fn();
    renderWithMantine(
      <ExperimentalFeaturesPanel
        {...baseProps}
        customHeaders={[{ key: "X-Auth", value: "Bearer 1" }]}
        onHeaderChange={onHeaderChange}
      />,
    );
    const keyInput = screen.getByDisplayValue("X-Auth");
    await user.type(keyInput, "Z");
    expect(onHeaderChange).toHaveBeenCalled();
    const lastCall =
      onHeaderChange.mock.calls[onHeaderChange.mock.calls.length - 1];
    expect(lastCall[0]).toBe(0);
    expect(lastCall[2]).toBe("Bearer 1");
  });

  it("invokes onHeaderChange when value changes for a header", async () => {
    const user = userEvent.setup();
    const onHeaderChange = vi.fn();
    renderWithMantine(
      <ExperimentalFeaturesPanel
        {...baseProps}
        customHeaders={[{ key: "X-Auth", value: "abc" }]}
        onHeaderChange={onHeaderChange}
      />,
    );
    const valueInput = screen.getByDisplayValue("abc");
    await user.type(valueInput, "Z");
    expect(onHeaderChange).toHaveBeenCalled();
    const lastCall =
      onHeaderChange.mock.calls[onHeaderChange.mock.calls.length - 1];
    expect(lastCall[0]).toBe(0);
    expect(lastCall[1]).toBe("X-Auth");
  });

  it("invokes onRemoveHeader with the header index when the remove icon is clicked", async () => {
    const user = userEvent.setup();
    const onRemoveHeader = vi.fn();
    renderWithMantine(
      <ExperimentalFeaturesPanel
        {...baseProps}
        customHeaders={[
          { key: "X-Auth", value: "abc" },
          { key: "X-Other", value: "def" },
        ]}
        onRemoveHeader={onRemoveHeader}
      />,
    );
    const removeButtons = screen.getAllByRole("button", { name: "✕" });
    await user.click(removeButtons[1]);
    expect(onRemoveHeader).toHaveBeenCalledWith(1);
  });

  it("invokes onRequestChange when the request textarea changes", async () => {
    const user = userEvent.setup();
    const onRequestChange = vi.fn();
    renderWithMantine(
      <ExperimentalFeaturesPanel
        {...baseProps}
        requestDraft=""
        onRequestChange={onRequestChange}
      />,
    );
    const textarea = screen.getByLabelText("Request");
    await user.type(textarea, "x");
    expect(onRequestChange).toHaveBeenCalledWith("x");
  });

  it("invokes onSendRequest when Send Request is clicked", async () => {
    const user = userEvent.setup();
    const onSendRequest = vi.fn();
    renderWithMantine(
      <ExperimentalFeaturesPanel
        {...baseProps}
        onSendRequest={onSendRequest}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Send Request" }));
    expect(onSendRequest).toHaveBeenCalledTimes(1);
  });

  it("renders a successful response without an Error badge", () => {
    renderWithMantine(
      <ExperimentalFeaturesPanel
        {...baseProps}
        response={{
          jsonrpc: "2.0",
          id: 1,
          result: { ok: true },
        }}
      />,
    );
    expect(screen.getByText("Response")).toBeInTheDocument();
    expect(screen.queryByText("Error")).not.toBeInTheDocument();
  });

  it("renders an error response with the Error badge", () => {
    renderWithMantine(
      <ExperimentalFeaturesPanel
        {...baseProps}
        response={{
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32601, message: "Method not found" },
        }}
      />,
    );
    expect(screen.getByText("Response")).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("invokes onCopyResponse when Copy is clicked", async () => {
    const user = userEvent.setup();
    const onCopyResponse = vi.fn();
    renderWithMantine(
      <ExperimentalFeaturesPanel
        {...baseProps}
        response={{ jsonrpc: "2.0", id: 1, result: { ok: true } }}
        onCopyResponse={onCopyResponse}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Copy" }));
    expect(onCopyResponse).toHaveBeenCalledTimes(1);
  });

  it("renders the request history table when entries are present", () => {
    const items: RequestHistoryItem[] = [
      {
        timestamp: new Date("2026-03-17T10:30:15Z"),
        method: "experimental/metrics.get",
        status: "success",
        durationMs: 42,
      },
      {
        timestamp: new Date("2026-03-17T10:29:50Z"),
        method: "experimental/echo",
        status: "error",
        durationMs: 120,
      },
    ];
    renderWithMantine(
      <ExperimentalFeaturesPanel {...baseProps} requestHistory={items} />,
    );
    expect(screen.getByText("Request History:")).toBeInTheDocument();
    expect(screen.getByText("experimental/metrics.get")).toBeInTheDocument();
    expect(screen.getByText("experimental/echo")).toBeInTheDocument();
    expect(screen.getByText("42ms")).toBeInTheDocument();
    expect(screen.getByText("120ms")).toBeInTheDocument();
  });

  it("does not render the history section when requestHistory is empty", () => {
    renderWithMantine(<ExperimentalFeaturesPanel {...baseProps} />);
    expect(screen.queryByText("Request History:")).not.toBeInTheDocument();
  });
});
