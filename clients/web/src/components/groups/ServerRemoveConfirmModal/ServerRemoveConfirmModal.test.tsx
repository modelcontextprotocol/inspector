import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { waitFor } from "@testing-library/react";
import type { ServerEntry } from "@inspector/core/mcp/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ServerRemoveConfirmModal } from "./ServerRemoveConfirmModal";

const stdioTarget: ServerEntry = {
  id: "alpha",
  name: "alpha",
  config: {
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-everything"],
  },
  connection: { status: "disconnected" },
};

const httpTarget: ServerEntry = {
  id: "remote",
  name: "remote",
  config: { type: "streamable-http", url: "https://x.test/mcp" },
  connection: { status: "disconnected" },
};

const stdioNoTypeNoArgs: ServerEntry = {
  id: "bare",
  name: "bare",
  // No `type` field and no `args` — exercises the `type ?? "stdio"` fallback
  // and the `args ?? []` fallback in summarize().
  config: { command: "run-it" },
  connection: { status: "disconnected" },
};

describe("ServerRemoveConfirmModal", () => {
  it("does not render when opened is false", () => {
    renderWithMantine(
      <ServerRemoveConfirmModal
        opened={false}
        target={stdioTarget}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.queryByText(/Remove server\?/i)).not.toBeInTheDocument();
  });

  it("shows the target id and stdio command summary", () => {
    renderWithMantine(
      <ServerRemoveConfirmModal
        opened
        target={stdioTarget}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(
      screen.getByText(/npx -y @modelcontextprotocol\/server-everything/),
    ).toBeInTheDocument();
  });

  it("shows the url for http transports", () => {
    renderWithMantine(
      <ServerRemoveConfirmModal
        opened
        target={httpTarget}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/streamable-http · https:\/\/x\.test\/mcp/),
    ).toBeInTheDocument();
  });

  it("calls onCancel when Cancel is clicked", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    renderWithMantine(
      <ServerRemoveConfirmModal
        opened
        target={stdioTarget}
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("calls onConfirm when Remove is clicked", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    renderWithMantine(
      <ServerRemoveConfirmModal
        opened
        target={stdioTarget}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^Remove$/ }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
  });

  it("surfaces an error message and stays open when onConfirm rejects", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockRejectedValue(new Error("disk full"));
    const onCancel = vi.fn();
    renderWithMantine(
      <ServerRemoveConfirmModal
        opened
        target={stdioTarget}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^Remove$/ }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/disk full/);
    });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("defaults the transport label to stdio and omits args when neither is set", () => {
    renderWithMantine(
      <ServerRemoveConfirmModal
        opened
        target={stdioNoTypeNoArgs}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    // `type ?? "stdio"` falls back to "stdio"; summarize joins just the command
    // since `args` is undefined (`args ?? []`).
    expect(screen.getByText(/stdio · run-it/)).toBeInTheDocument();
  });

  it("stringifies a non-Error rejection value in the alert", async () => {
    const user = userEvent.setup();
    // Rejecting with a plain string takes the `String(err)` branch.
    const onConfirm = vi.fn().mockRejectedValue("plain string failure");
    renderWithMantine(
      <ServerRemoveConfirmModal
        opened
        target={stdioTarget}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^Remove$/ }));
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /plain string failure/,
      );
    });
  });

  it("is a no-op when Remove is clicked with no target", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    renderWithMantine(
      <ServerRemoveConfirmModal
        opened
        target={null}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^Remove$/ }));
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
