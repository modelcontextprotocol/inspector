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
