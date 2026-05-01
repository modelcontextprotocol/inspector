import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ElicitationUrlPanel } from "./ElicitationUrlPanel";

const baseProps = {
  message: "Please authenticate with the external service.",
  url: "https://auth.example.com/oauth/authorize?client_id=mcp-inspector",
  requestId: "elicit-abc-123",
  isWaiting: false,
  onCopyUrl: vi.fn(),
  onOpenInBrowser: vi.fn(),
  onCancel: vi.fn(),
};

describe("ElicitationUrlPanel", () => {
  it("renders the message, url, and request id", () => {
    renderWithMantine(<ElicitationUrlPanel {...baseProps} />);
    expect(
      screen.getByText("Please authenticate with the external service."),
    ).toBeInTheDocument();
    expect(screen.getByText(baseProps.url)).toBeInTheDocument();
    expect(
      screen.getByText(`Request ID: ${baseProps.requestId}`),
    ).toBeInTheDocument();
  });

  it("renders the warning alert", () => {
    renderWithMantine(<ElicitationUrlPanel {...baseProps} />);
    expect(screen.getByText("Warning")).toBeInTheDocument();
    expect(
      screen.getByText(/This will open an external URL/),
    ).toBeInTheDocument();
  });

  it("does not render waiting indicator when isWaiting is false", () => {
    renderWithMantine(<ElicitationUrlPanel {...baseProps} />);
    expect(
      screen.queryByText("Waiting for completion..."),
    ).not.toBeInTheDocument();
  });

  it("renders waiting indicator when isWaiting is true", () => {
    renderWithMantine(<ElicitationUrlPanel {...baseProps} isWaiting />);
    expect(screen.getByText("Waiting for completion...")).toBeInTheDocument();
  });

  it("invokes onCopyUrl when Copy URL is clicked", async () => {
    const user = userEvent.setup();
    const onCopyUrl = vi.fn();
    renderWithMantine(
      <ElicitationUrlPanel {...baseProps} onCopyUrl={onCopyUrl} />,
    );
    await user.click(screen.getByRole("button", { name: "Copy URL" }));
    expect(onCopyUrl).toHaveBeenCalledTimes(1);
  });

  it("invokes onOpenInBrowser when Open in Browser is clicked", async () => {
    const user = userEvent.setup();
    const onOpenInBrowser = vi.fn();
    renderWithMantine(
      <ElicitationUrlPanel {...baseProps} onOpenInBrowser={onOpenInBrowser} />,
    );
    await user.click(screen.getByRole("button", { name: "Open in Browser" }));
    expect(onOpenInBrowser).toHaveBeenCalledTimes(1);
  });

  it("invokes onCancel when Cancel is clicked", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    renderWithMantine(
      <ElicitationUrlPanel {...baseProps} onCancel={onCancel} />,
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
