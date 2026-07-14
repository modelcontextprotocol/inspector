import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import {
  renderWithMantine,
  screen,
  waitFor,
} from "../../../test/renderWithMantine";
import { ResourceLink } from "./ResourceLink";

const URI = "file:///docs/readme.md";

const readResult = (text: string): ReadResourceResult => ({
  contents: [{ uri: URI, mimeType: "text/plain", text }],
});

describe("ResourceLink", () => {
  it("renders uri, name, and mimeType", () => {
    renderWithMantine(
      <ResourceLink uri={URI} name="Readme" mimeType="text/markdown" />,
    );
    expect(screen.getByText(URI)).toBeInTheDocument();
    expect(screen.getByText("Readme")).toBeInTheDocument();
    expect(screen.getByText("text/markdown")).toBeInTheDocument();
  });

  it("renders no expand control without onReadResource", () => {
    renderWithMantine(<ResourceLink uri={URI} />);
    // The URI copy button is always present, but there's no expand affordance.
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Expand" }),
    ).not.toBeInTheDocument();
  });

  it("reads the resource on demand and renders the result inline", async () => {
    const user = userEvent.setup();
    const onReadResource = vi.fn().mockResolvedValue(readResult("hello body"));
    renderWithMantine(
      <ResourceLink uri={URI} onReadResource={onReadResource} />,
    );

    await user.click(screen.getByRole("button", { name: "Expand" }));

    expect(onReadResource).toHaveBeenCalledWith(URI);
    // The full read result is rendered inline as formatted JSON.
    await waitFor(() =>
      expect(screen.getByText(/"hello body"/)).toBeInTheDocument(),
    );
    // The toggle flips to the collapse control once expanded.
    expect(
      screen.getByRole("button", { name: "Collapse" }),
    ).toBeInTheDocument();
  });

  it("collapses and re-expands without re-reading (result cached)", async () => {
    const user = userEvent.setup();
    const onReadResource = vi.fn().mockResolvedValue(readResult("cached body"));
    renderWithMantine(
      <ResourceLink uri={URI} onReadResource={onReadResource} />,
    );

    await user.click(screen.getByRole("button", { name: "Expand" }));
    await waitFor(() =>
      expect(screen.getByText(/"cached body"/)).toBeInTheDocument(),
    );

    // Collapse — the toggle flips back to the expand control. (The read result
    // stays mounted inside the animated Collapse, so it isn't re-read.)
    await user.click(screen.getByRole("button", { name: "Collapse" }));
    expect(screen.getByRole("button", { name: "Expand" })).toBeInTheDocument();

    // Re-expand — content is still present without a second read.
    await user.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getByText(/"cached body"/)).toBeInTheDocument();
    expect(onReadResource).toHaveBeenCalledTimes(1);
  });

  it("shows an alert when the read fails", async () => {
    const user = userEvent.setup();
    const onReadResource = vi.fn().mockRejectedValue(new Error("nope"));
    renderWithMantine(
      <ResourceLink uri={URI} onReadResource={onReadResource} />,
    );

    await user.click(screen.getByRole("button", { name: "Expand" }));
    await waitFor(() =>
      expect(screen.getByText("Failed to read resource")).toBeInTheDocument(),
    );
    expect(screen.getByText("nope")).toBeInTheDocument();
  });

  it("stringifies a non-Error rejection in the failure alert", async () => {
    const user = userEvent.setup();
    // Reject with a plain string (not an Error) so the `String(err)`
    // branch of the catch handler is exercised.
    const onReadResource = vi.fn().mockRejectedValue("boom-string");
    renderWithMantine(
      <ResourceLink uri={URI} onReadResource={onReadResource} />,
    );

    await user.click(screen.getByRole("button", { name: "Expand" }));
    await waitFor(() =>
      expect(screen.getByText("Failed to read resource")).toBeInTheDocument(),
    );
    expect(screen.getByText("boom-string")).toBeInTheDocument();
  });

  it("retries the read on re-expand after a failure", async () => {
    const user = userEvent.setup();
    const onReadResource = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce(readResult("recovered body"));
    renderWithMantine(
      <ResourceLink uri={URI} onReadResource={onReadResource} />,
    );

    // First expand fails.
    await user.click(screen.getByRole("button", { name: "Expand" }));
    await waitFor(() =>
      expect(screen.getByText("Failed to read resource")).toBeInTheDocument(),
    );

    // Collapse, then re-expand — the read is retried (error is not cached).
    await user.click(screen.getByRole("button", { name: "Collapse" }));
    await user.click(screen.getByRole("button", { name: "Expand" }));

    await waitFor(() =>
      expect(screen.getByText(/"recovered body"/)).toBeInTheDocument(),
    );
    expect(
      screen.queryByText("Failed to read resource"),
    ).not.toBeInTheDocument();
    expect(onReadResource).toHaveBeenCalledTimes(2);
  });

  it("does not fire a second read when toggled while a read is in flight", async () => {
    const user = userEvent.setup();
    let resolveRead: (value: ReadResourceResult) => void = () => {};
    const onReadResource = vi.fn().mockImplementation(
      () =>
        new Promise<ReadResourceResult>((resolve) => {
          resolveRead = resolve;
        }),
    );
    renderWithMantine(
      <ResourceLink uri={URI} onReadResource={onReadResource} />,
    );

    // Expand — read is in flight (loading), then collapse and re-expand.
    await user.click(screen.getByRole("button", { name: "Expand" }));
    await user.click(screen.getByRole("button", { name: "Collapse" }));
    await user.click(screen.getByRole("button", { name: "Expand" }));

    // Still only the original in-flight read — no redundant fetch.
    expect(onReadResource).toHaveBeenCalledTimes(1);

    resolveRead(readResult("in flight body"));
    await waitFor(() =>
      expect(screen.getByText(/"in flight body"/)).toBeInTheDocument(),
    );
  });
});
