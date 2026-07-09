import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { waitFor, within } from "@testing-library/react";
import type { MCPServerConfig } from "@inspector/core/mcp/types.js";
import { renderWithMantine, screen } from "../../../test/renderWithMantine";
import { ServerConfigModal } from "./ServerConfigModal";

/** Find the "Clear" button living in the rightSection of `input`'s field. */
function clearButtonFor(input: HTMLElement): HTMLElement {
  const root =
    input.closest('[class*="mantine-TextInput-root"]') ??
    input.closest('[class*="Input-wrapper"]');
  return within(root as HTMLElement).getByRole("button", { name: "Clear" });
}

describe("ServerConfigModal", () => {
  function base(overrides: Partial<{ existingIds: string[] }> = {}) {
    return {
      opened: true,
      mode: "add" as const,
      existingIds: overrides.existingIds ?? [],
      onClose: vi.fn(),
      onSubmit: vi.fn().mockResolvedValue(undefined),
    };
  }

  it("does not render when opened is false", () => {
    renderWithMantine(<ServerConfigModal {...base()} opened={false} />);
    expect(screen.queryByText("Add server")).not.toBeInTheDocument();
  });

  it("renders the add title and stdio fields by default", () => {
    renderWithMantine(<ServerConfigModal {...base()} />);
    expect(screen.getByText("Add server")).toBeInTheDocument();
    expect(screen.getByLabelText(/Server ID/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Command/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Arguments/i)).toBeInTheDocument();
  });

  it("rejects an id containing illegal characters", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithMantine(<ServerConfigModal {...base()} />);
    await user.type(screen.getByLabelText(/Server ID/i), "bad id!");
    expect(
      screen.getByText(/letters, numbers, hyphens, and underscores/i),
    ).toBeInTheDocument();
  });

  it("flags duplicate ids against existingIds", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithMantine(
      <ServerConfigModal {...base({ existingIds: ["alpha"] })} />,
    );
    await user.type(screen.getByLabelText(/Server ID/i), "alpha");
    expect(screen.getByText(/already exists/i)).toBeInTheDocument();
  });

  it("calls onSubmit with a valid stdio config", async () => {
    const user = userEvent.setup({ delay: null });
    const props = base();
    renderWithMantine(<ServerConfigModal {...props} />);

    await user.type(screen.getByLabelText(/Server ID/i), "alpha");
    await user.type(screen.getByLabelText(/Command/i), "node");
    await user.type(screen.getByLabelText(/Arguments/i), "x.js\n--port=3000");
    await user.click(screen.getByRole("button", { name: /^Add$/ }));

    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledOnce());
    expect(props.onSubmit).toHaveBeenCalledWith("alpha", {
      type: "stdio",
      command: "node",
      args: ["x.js", "--port=3000"],
    });
  });

  it("requires a command for stdio submission", async () => {
    const user = userEvent.setup({ delay: null });
    const props = base();
    renderWithMantine(<ServerConfigModal {...props} />);

    await user.type(screen.getByLabelText(/Server ID/i), "alpha");
    await user.click(screen.getByRole("button", { name: /^Add$/ }));

    expect(screen.getByRole("alert")).toHaveTextContent(/Command is required/i);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("rejects malformed env lines", async () => {
    const user = userEvent.setup({ delay: null });
    const props = base();
    renderWithMantine(<ServerConfigModal {...props} />);

    await user.type(screen.getByLabelText(/Server ID/i), "alpha");
    await user.type(screen.getByLabelText(/Command/i), "node");
    await user.type(screen.getByLabelText(/Environment/i), "BAD_LINE");
    await user.click(screen.getByRole("button", { name: /^Add$/ }));

    expect(screen.getByRole("alert")).toHaveTextContent(/Invalid env/i);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  // Mantine Select uses a portal-mounted dropdown that happy-dom doesn't
  // open reliably; we exercise the sse rendering branch by seeding the form
  // with an sse initialConfig (the same code path the Select onChange takes).

  it("renders url (and hides stdio fields) when transport is sse", () => {
    renderWithMantine(
      <ServerConfigModal
        {...base()}
        mode="edit"
        initialId="remote"
        initialConfig={{ type: "sse", url: "https://x.test/sse" }}
      />,
    );
    expect(screen.getByLabelText(/^URL/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Headers/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Command/)).not.toBeInTheDocument();
  });

  it("submits an sse config with just the url (headers move to the settings form)", async () => {
    const user = userEvent.setup({ delay: null });
    const props = base();
    renderWithMantine(
      <ServerConfigModal
        {...props}
        mode="edit"
        initialId="remote"
        initialConfig={{ type: "sse", url: "" }}
      />,
    );

    await user.type(screen.getByLabelText(/^URL/), "https://x.test/sse");
    await user.click(screen.getByRole("button", { name: /^Save$/ }));

    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledOnce());
    expect(props.onSubmit).toHaveBeenCalledWith("remote", {
      type: "sse",
      url: "https://x.test/sse",
    });
  });

  it("submits a streamable-http config", async () => {
    const user = userEvent.setup({ delay: null });
    const props = base();
    renderWithMantine(
      <ServerConfigModal
        {...props}
        mode="edit"
        initialId="http-srv"
        initialConfig={{ type: "streamable-http", url: "https://x.test/mcp" }}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledOnce());
    expect(props.onSubmit).toHaveBeenCalledWith("http-srv", {
      type: "streamable-http",
      url: "https://x.test/mcp",
    });
  });

  it("loads the url from a streamable-http config", () => {
    renderWithMantine(
      <ServerConfigModal
        {...base()}
        mode="edit"
        initialId="http-srv"
        initialConfig={{
          type: "streamable-http",
          url: "https://x.test/mcp",
        }}
      />,
    );
    expect(screen.getByLabelText(/^URL/)).toHaveValue("https://x.test/mcp");
  });

  it("rejects an empty URL on sse submission", async () => {
    const user = userEvent.setup({ delay: null });
    const props = base();
    renderWithMantine(
      <ServerConfigModal
        {...props}
        mode="edit"
        initialId="remote"
        initialConfig={{ type: "sse", url: "" }}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^Save$/ }));
    expect(screen.getByRole("alert")).toHaveTextContent(/URL is required/i);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("pre-populates fields in edit mode", () => {
    const initialConfig: MCPServerConfig = {
      type: "stdio",
      command: "node",
      args: ["server.js"],
      env: { DEBUG: "1" },
      cwd: "/tmp/here",
    };
    renderWithMantine(
      <ServerConfigModal
        {...base()}
        mode="edit"
        initialId="alpha"
        initialConfig={initialConfig}
      />,
    );
    expect(screen.getByText("Edit server")).toBeInTheDocument();
    expect(screen.getByLabelText(/Server ID/i)).toHaveValue("alpha");
    expect(screen.getByLabelText(/Command/i)).toHaveValue("node");
    expect(screen.getByLabelText(/Arguments/i)).toHaveValue("server.js");
    expect(screen.getByLabelText(/Environment/i)).toHaveValue("DEBUG=1");
    expect(screen.getByLabelText(/Working directory/i)).toHaveValue(
      "/tmp/here",
    );
  });

  it("clears the id field in clone mode (everything else carries over)", () => {
    const initialConfig: MCPServerConfig = {
      type: "stdio",
      command: "node",
    };
    renderWithMantine(
      <ServerConfigModal
        {...base()}
        mode="clone"
        initialId="alpha"
        initialConfig={initialConfig}
      />,
    );
    expect(screen.getByText("Clone server")).toBeInTheDocument();
    expect(screen.getByLabelText(/Server ID/i)).toHaveValue("");
    expect(screen.getByLabelText(/Command/i)).toHaveValue("node");
  });

  it("shows the error message and stays open when onSubmit rejects", async () => {
    const user = userEvent.setup({ delay: null });
    const props = {
      ...base(),
      onSubmit: vi.fn().mockRejectedValue(new Error("server full")),
    };
    renderWithMantine(<ServerConfigModal {...props} />);

    await user.type(screen.getByLabelText(/Server ID/i), "alpha");
    await user.type(screen.getByLabelText(/Command/i), "node");
    await user.click(screen.getByRole("button", { name: /^Add$/ }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/server full/);
    });
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("blocks submit and shows the id error message on bad-id submit click", async () => {
    const user = userEvent.setup({ delay: null });
    const props = base({ existingIds: ["alpha"] });
    renderWithMantine(<ServerConfigModal {...props} />);

    await user.type(screen.getByLabelText(/Server ID/i), "alpha");
    await user.type(screen.getByLabelText(/Command/i), "node");
    await user.click(screen.getByRole("button", { name: /^Add$/ }));

    expect(screen.getByRole("alert")).toHaveTextContent(/already exists/i);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("supports editing the working directory field", async () => {
    const user = userEvent.setup({ delay: null });
    const props = base();
    renderWithMantine(<ServerConfigModal {...props} />);

    await user.type(screen.getByLabelText(/Server ID/i), "alpha");
    await user.type(screen.getByLabelText(/Command/i), "node");
    await user.type(screen.getByLabelText(/Working directory/i), "/tmp/cwd");
    await user.click(screen.getByRole("button", { name: /^Add$/ }));

    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledOnce());
    expect(props.onSubmit).toHaveBeenCalledWith("alpha", {
      type: "stdio",
      command: "node",
      cwd: "/tmp/cwd",
    });
  });

  it("clears the Server ID field via its Clear button", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithMantine(
      <ServerConfigModal
        {...base()}
        mode="edit"
        initialId="alpha"
        initialConfig={{ type: "stdio", command: "node" }}
      />,
    );
    const idInput = screen.getByLabelText(/Server ID/i);
    expect(idInput).toHaveValue("alpha");
    await user.click(clearButtonFor(idInput));
    expect(idInput).toHaveValue("");
  });

  it("clears the Command field via its Clear button", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithMantine(
      <ServerConfigModal
        {...base()}
        mode="edit"
        initialId="alpha"
        initialConfig={{ type: "stdio", command: "node" }}
      />,
    );
    const cmdInput = screen.getByLabelText(/Command/i);
    expect(cmdInput).toHaveValue("node");
    await user.click(clearButtonFor(cmdInput));
    expect(cmdInput).toHaveValue("");
  });

  it("clears the URL field via its Clear button", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithMantine(
      <ServerConfigModal
        {...base()}
        mode="edit"
        initialId="remote"
        initialConfig={{ type: "sse", url: "https://x.test/sse" }}
      />,
    );
    const urlInput = screen.getByLabelText(/^URL/);
    expect(urlInput).toHaveValue("https://x.test/sse");
    await user.click(clearButtonFor(urlInput));
    expect(urlInput).toHaveValue("");
  });

  it("clears the Arguments field via its Clear button", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithMantine(
      <ServerConfigModal
        {...base()}
        mode="edit"
        initialId="alpha"
        initialConfig={{
          type: "stdio",
          command: "node",
          args: ["server.js", "--port=3000"],
        }}
      />,
    );
    const argsInput = screen.getByLabelText(/Arguments/i);
    expect(argsInput).toHaveValue("server.js\n--port=3000");
    await user.click(clearButtonFor(argsInput));
    expect(argsInput).toHaveValue("");
  });

  it("clears the Environment field via its Clear button", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithMantine(
      <ServerConfigModal
        {...base()}
        mode="edit"
        initialId="alpha"
        initialConfig={{
          type: "stdio",
          command: "node",
          env: { DEBUG: "1" },
        }}
      />,
    );
    const envInput = screen.getByLabelText(/Environment/i);
    expect(envInput).toHaveValue("DEBUG=1");
    await user.click(clearButtonFor(envInput));
    expect(envInput).toHaveValue("");
  });

  it("clears the Working directory field via its Clear button", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithMantine(
      <ServerConfigModal
        {...base()}
        mode="edit"
        initialId="alpha"
        initialConfig={{
          type: "stdio",
          command: "node",
          cwd: "/tmp/here",
        }}
      />,
    );
    const cwdInput = screen.getByLabelText(/Working directory/i);
    expect(cwdInput).toHaveValue("/tmp/here");
    await user.click(clearButtonFor(cwdInput));
    expect(cwdInput).toHaveValue("");
  });

  it("switches transport via the Transport select, revealing the URL field", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithMantine(<ServerConfigModal {...base()} />);

    // Starts on stdio — Command is shown, URL is not.
    expect(screen.getByLabelText(/^Command/)).toBeInTheDocument();

    await user.click(screen.getByRole("textbox", { name: /Transport/i }));
    const option = await screen.findByRole("option", {
      name: /sse \(Server-Sent Events\)/,
      hidden: true,
    });
    await user.click(option);

    // The onChange handler set transport to sse, so the URL field renders
    // and the stdio Command field is gone.
    expect(await screen.findByLabelText(/^URL/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Command/)).not.toBeInTheDocument();
  });

  it("requires a server id before submitting", async () => {
    const user = userEvent.setup({ delay: null });
    const props = base();
    renderWithMantine(<ServerConfigModal {...props} />);

    // No id typed at all — handleSubmit short-circuits on the empty id
    // before it ever validates the transport config.
    await user.type(screen.getByLabelText(/Command/i), "node");
    await user.click(screen.getByRole("button", { name: /^Add$/ }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      /Server id is required/i,
    );
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("rejects an env line whose '=' is at the start (no key)", async () => {
    const user = userEvent.setup({ delay: null });
    const props = base();
    renderWithMantine(<ServerConfigModal {...props} />);

    await user.type(screen.getByLabelText(/Server ID/i), "alpha");
    await user.type(screen.getByLabelText(/Command/i), "node");
    // "=value" has the "=" at index 0 (eq === 0), the falsy-index guard.
    await user.type(screen.getByLabelText(/Environment/i), "=value");
    await user.click(screen.getByRole("button", { name: /^Add$/ }));

    expect(screen.getByRole("alert")).toHaveTextContent(/Use KEY=VALUE/i);
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("calls onClose when Cancel is clicked", async () => {
    const user = userEvent.setup({ delay: null });
    const props = base();
    renderWithMantine(<ServerConfigModal {...props} />);
    await user.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(props.onClose).toHaveBeenCalledOnce();
  });
});
