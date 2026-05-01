import { describe, it, expect } from "vitest";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ServerStatusIndicator } from "./ServerStatusIndicator";

describe("ServerStatusIndicator", () => {
  it("renders the connected label with latency", () => {
    renderWithMantine(
      <ServerStatusIndicator status="connected" latencyMs={120} showLabel />,
    );
    expect(screen.getByText("Connected (120ms)")).toBeInTheDocument();
  });

  it("renders just 'Connected' when latency is missing", () => {
    renderWithMantine(<ServerStatusIndicator status="connected" showLabel />);
    expect(screen.getByText("Connected")).toBeInTheDocument();
  });

  it("renders the connecting label", () => {
    renderWithMantine(<ServerStatusIndicator status="connecting" showLabel />);
    expect(screen.getByText("Connecting...")).toBeInTheDocument();
  });

  it("renders the disconnected label", () => {
    renderWithMantine(
      <ServerStatusIndicator status="disconnected" showLabel />,
    );
    expect(screen.getByText("Disconnected")).toBeInTheDocument();
  });

  it("renders the error label with retry count", () => {
    renderWithMantine(
      <ServerStatusIndicator status="error" retryCount={3} showLabel />,
    );
    expect(screen.getByText("Error (3)")).toBeInTheDocument();
  });

  it("renders just 'Error' without a retry count", () => {
    renderWithMantine(<ServerStatusIndicator status="error" showLabel />);
    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("hides label and uses title when showLabel is false", () => {
    renderWithMantine(
      <ServerStatusIndicator
        status="connected"
        latencyMs={50}
        showLabel={false}
      />,
    );
    expect(screen.queryByText("Connected (50ms)")).not.toBeInTheDocument();
  });
});
