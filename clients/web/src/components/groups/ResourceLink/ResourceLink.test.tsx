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
  it("renders uri, name, description, and mimeType", () => {
    renderWithMantine(
      <ResourceLink
        uri={URI}
        name="Readme"
        description="The project readme"
        mimeType="text/markdown"
      />,
    );
    expect(screen.getByText(URI)).toBeInTheDocument();
    expect(screen.getByText("Readme")).toBeInTheDocument();
    expect(screen.getByText("The project readme")).toBeInTheDocument();
    expect(screen.getByText("text/markdown")).toBeInTheDocument();
  });

  it("is not interactive without onReadResource", () => {
    renderWithMantine(<ResourceLink uri={URI} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("reads the resource on demand and renders the result inline", async () => {
    const user = userEvent.setup();
    const onReadResource = vi.fn().mockResolvedValue(readResult("hello body"));
    renderWithMantine(
      <ResourceLink uri={URI} onReadResource={onReadResource} />,
    );

    const button = screen.getByRole("button", {
      name: `Expand resource ${URI}`,
    });
    expect(button).toHaveAttribute("aria-expanded", "false");

    await user.click(button);

    expect(onReadResource).toHaveBeenCalledWith(URI);
    await waitFor(() =>
      expect(screen.getByText("Resource:")).toBeInTheDocument(),
    );
    // The full read result is rendered as formatted JSON.
    expect(screen.getByText(/"hello body"/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `Collapse resource ${URI}` }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("collapses and re-expands without re-reading (result cached)", async () => {
    const user = userEvent.setup();
    const onReadResource = vi.fn().mockResolvedValue(readResult("cached body"));
    renderWithMantine(
      <ResourceLink uri={URI} onReadResource={onReadResource} />,
    );

    await user.click(
      screen.getByRole("button", { name: `Expand resource ${URI}` }),
    );
    await waitFor(() =>
      expect(screen.getByText(/"cached body"/)).toBeInTheDocument(),
    );

    // Collapse — content is hidden.
    await user.click(
      screen.getByRole("button", { name: `Collapse resource ${URI}` }),
    );
    expect(screen.queryByText("Resource:")).not.toBeInTheDocument();

    // Re-expand — content returns without a second read.
    await user.click(
      screen.getByRole("button", { name: `Expand resource ${URI}` }),
    );
    expect(screen.getByText(/"cached body"/)).toBeInTheDocument();
    expect(onReadResource).toHaveBeenCalledTimes(1);
  });

  it("shows an alert when the read fails", async () => {
    const user = userEvent.setup();
    const onReadResource = vi.fn().mockRejectedValue(new Error("nope"));
    renderWithMantine(
      <ResourceLink uri={URI} onReadResource={onReadResource} />,
    );

    await user.click(screen.getByRole("button"));
    await waitFor(() =>
      expect(screen.getByText("Failed to read resource")).toBeInTheDocument(),
    );
    expect(screen.getByText("nope")).toBeInTheDocument();
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
    await user.click(
      screen.getByRole("button", { name: `Expand resource ${URI}` }),
    );
    await waitFor(() =>
      expect(screen.getByText("Failed to read resource")).toBeInTheDocument(),
    );

    // Collapse, then re-expand — the read is retried (error is not cached).
    await user.click(
      screen.getByRole("button", { name: `Collapse resource ${URI}` }),
    );
    await user.click(
      screen.getByRole("button", { name: `Expand resource ${URI}` }),
    );

    await waitFor(() =>
      expect(screen.getByText(/"recovered body"/)).toBeInTheDocument(),
    );
    expect(screen.queryByText("Failed to read resource")).not.toBeInTheDocument();
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
    await user.click(
      screen.getByRole("button", { name: `Expand resource ${URI}` }),
    );
    await user.click(
      screen.getByRole("button", { name: `Collapse resource ${URI}` }),
    );
    await user.click(
      screen.getByRole("button", { name: `Expand resource ${URI}` }),
    );

    // Still only the original in-flight read — no redundant fetch.
    expect(onReadResource).toHaveBeenCalledTimes(1);

    resolveRead(readResult("in flight body"));
    await waitFor(() =>
      expect(screen.getByText(/"in flight body"/)).toBeInTheDocument(),
    );
  });
});
