import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import {
  renderWithMantine,
  screen,
  fireEvent,
  waitFor,
} from "../../../test/renderWithMantine";
import { ServerImportJsonModal } from "./ServerImportJsonModal";

const npmJson = JSON.stringify({
  name: "io.github.me/weather",
  packages: [
    {
      registryType: "npm",
      identifier: "@me/weather",
      version: "1.0.0",
      environmentVariables: [
        { name: "API_KEY", isRequired: true },
        { name: "LOG_LEVEL", default: "info" },
      ],
    },
  ],
});

const multiPackageJson = JSON.stringify({
  name: "io.github.me/multi",
  packages: [
    { registryType: "npm", identifier: "@me/multi" },
    { registryType: "pypi", identifier: "multi-py" },
  ],
});

/** The JSON textarea is the first textbox the panel renders. */
function pasteJson(text: string) {
  const textarea = screen.getAllByRole("textbox")[0];
  fireEvent.change(textarea, { target: { value: text } });
}

describe("ServerImportJsonModal", () => {
  it("renders nothing actionable when closed", () => {
    renderWithMantine(
      <ServerImportJsonModal
        opened={false}
        existingIds={[]}
        onClose={vi.fn()}
        onAddServer={vi.fn()}
      />,
    );
    expect(
      screen.queryByText("Import from registry config"),
    ).not.toBeInTheDocument();
  });

  it("hides validation results and the name override before any JSON is pasted", () => {
    renderWithMantine(
      <ServerImportJsonModal
        opened
        existingIds={[]}
        onClose={vi.fn()}
        onAddServer={vi.fn()}
      />,
    );
    expect(screen.queryByText("Validation Results:")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Server Name/)).not.toBeInTheDocument();
  });

  it("validates a pasted npm server.json and surfaces env vars", async () => {
    renderWithMantine(
      <ServerImportJsonModal
        opened
        existingIds={[]}
        onClose={vi.fn()}
        onAddServer={vi.fn()}
      />,
    );
    pasteJson(npmJson);
    // Validation is debounced, so it appears after a short pause.
    expect(
      await screen.findByText(/Valid server.json for "io.github.me\/weather"/),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 runnable option/)).toBeInTheDocument();
    // Env var inputs are rendered (required one + defaulted one).
    expect(screen.getByLabelText(/API_KEY/)).toBeInTheDocument();
    expect(screen.getByLabelText(/LOG_LEVEL/)).toBeInTheDocument();
  });

  it("reports a parse error for malformed JSON", async () => {
    renderWithMantine(
      <ServerImportJsonModal
        opened
        existingIds={[]}
        onClose={vi.fn()}
        onAddServer={vi.fn()}
      />,
    );
    pasteJson("{not json");
    expect(await screen.findByText(/Invalid JSON/)).toBeInTheDocument();
  });

  it("warns when the derived id already exists", async () => {
    renderWithMantine(
      <ServerImportJsonModal
        opened
        existingIds={["weather"]}
        onClose={vi.fn()}
        onAddServer={vi.fn()}
      />,
    );
    pasteJson(npmJson);
    expect(
      await screen.findByText(/A server with id "weather" already exists/),
    ).toBeInTheDocument();
  });

  it("builds the config with env overrides and calls onAddServer", async () => {
    const user = userEvent.setup();
    const onAddServer = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    renderWithMantine(
      <ServerImportJsonModal
        opened
        existingIds={[]}
        onClose={onClose}
        onAddServer={onAddServer}
      />,
    );
    pasteJson(npmJson);
    // The env-var inputs appear after the debounced parse.
    await user.type(await screen.findByLabelText(/API_KEY/), "secret");
    await user.click(screen.getByRole("button", { name: "Add Server" }));
    await waitFor(() => expect(onAddServer).toHaveBeenCalledTimes(1));
    const [id, config] = onAddServer.mock.calls[0];
    expect(id).toBe("weather");
    expect(config).toMatchObject({
      type: "stdio",
      command: "npx",
      args: ["-y", "@me/weather@1.0.0"],
      env: { API_KEY: "secret", LOG_LEVEL: "info" },
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("honors a server name override", async () => {
    const user = userEvent.setup();
    const onAddServer = vi.fn().mockResolvedValue(undefined);
    renderWithMantine(
      <ServerImportJsonModal
        opened
        existingIds={[]}
        onClose={vi.fn()}
        onAddServer={onAddServer}
      />,
    );
    pasteJson(npmJson);
    await user.type(screen.getByLabelText(/Server Name/), "my-weather");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add Server" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "Add Server" }));
    await waitFor(() => expect(onAddServer).toHaveBeenCalled());
    expect(onAddServer.mock.calls[0][0]).toBe("my-weather");
  });

  it("lets the user pick among multiple packages", async () => {
    const user = userEvent.setup();
    const onAddServer = vi.fn().mockResolvedValue(undefined);
    renderWithMantine(
      <ServerImportJsonModal
        opened
        existingIds={[]}
        onClose={vi.fn()}
        onAddServer={onAddServer}
      />,
    );
    pasteJson(multiPackageJson);
    // The package radios appear after the debounced parse.
    await user.click(await screen.findByLabelText(/pypi: multi-py/));
    await user.click(screen.getByRole("button", { name: "Add Server" }));
    await waitFor(() => expect(onAddServer).toHaveBeenCalled());
    expect(onAddServer.mock.calls[0][1]).toMatchObject({ command: "uvx" });
  });

  it("surfaces an onAddServer rejection instead of closing", async () => {
    const user = userEvent.setup();
    const onAddServer = vi.fn().mockRejectedValue(new Error("disk full"));
    const onClose = vi.fn();
    renderWithMantine(
      <ServerImportJsonModal
        opened
        existingIds={[]}
        onClose={onClose}
        onAddServer={onAddServer}
      />,
    );
    pasteJson(npmJson);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add Server" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "Add Server" }));
    await waitFor(() =>
      expect(screen.getByText(/disk full/)).toBeInTheDocument(),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("disables Add Server until valid content is present", () => {
    renderWithMantine(
      <ServerImportJsonModal
        opened
        existingIds={[]}
        onClose={vi.fn()}
        onAddServer={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Add Server" })).toBeDisabled();
  });

  it("guards against a live edit made before the debounce re-validates", async () => {
    const onAddServer = vi.fn();
    renderWithMantine(
      <ServerImportJsonModal
        opened
        existingIds={[]}
        onClose={vi.fn()}
        onAddServer={onAddServer}
      />,
    );
    pasteJson(npmJson);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add Server" })).toBeEnabled(),
    );
    // Replace with invalid content; the button hasn't re-disabled yet (the
    // debounce is still pending), so clicking exercises the submit-time guard.
    pasteJson("{not json");
    fireEvent.click(screen.getByRole("button", { name: "Add Server" }));
    expect(onAddServer).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/Fix the validation errors/),
    ).toBeInTheDocument();
  });

  it("loads server.json from a chosen file", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ServerImportJsonModal
        opened
        existingIds={[]}
        onClose={vi.fn()}
        onAddServer={vi.fn()}
      />,
    );
    const file = new File([npmJson], "server.json", {
      type: "application/json",
    });
    // The Modal is portaled, so query the file input from the document.
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await user.upload(input, file);
    await waitFor(() =>
      expect(
        screen.getByText(/Valid server.json for "io.github.me\/weather"/),
      ).toBeInTheDocument(),
    );
  });

  it("auto-collapses the File Contents disclosure after content loads", async () => {
    renderWithMantine(
      <ServerImportJsonModal
        opened
        existingIds={[]}
        onClose={vi.fn()}
        onAddServer={vi.fn()}
      />,
    );
    const disclosure = screen.getByRole("button", { name: "File Contents" });
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    pasteJson(npmJson);
    await waitFor(
      () => expect(disclosure).toHaveAttribute("aria-expanded", "false"),
      { timeout: 3000 },
    );
  });

  it("re-opens File Contents when the textarea is cleared", async () => {
    const user = userEvent.setup();
    renderWithMantine(
      <ServerImportJsonModal
        opened
        existingIds={[]}
        onClose={vi.fn()}
        onAddServer={vi.fn()}
      />,
    );
    pasteJson(npmJson);
    const disclosure = screen.getByRole("button", { name: "File Contents" });
    // Clear via the textarea's Clear button while still expanded.
    await user.click(screen.getAllByRole("button", { name: "Clear" })[0]);
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
  });

  it("rejects an invalid id override and blocks Add Server", async () => {
    const user = userEvent.setup();
    const onAddServer = vi.fn();
    renderWithMantine(
      <ServerImportJsonModal
        opened
        existingIds={[]}
        onClose={vi.fn()}
        onAddServer={onAddServer}
      />,
    );
    pasteJson(npmJson);
    await user.type(screen.getByLabelText(/Server Name/), "bad id!");
    expect(
      await screen.findByText(/Server id must use only letters/),
    ).toBeInTheDocument();
    // An invalid id keeps the Add button disabled.
    expect(screen.getByRole("button", { name: "Add Server" })).toBeDisabled();
    expect(onAddServer).not.toHaveBeenCalled();
  });

  it("closes via the Escape key (no Cancel button)", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithMantine(
      <ServerImportJsonModal
        opened
        existingIds={[]}
        onClose={onClose}
        onAddServer={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Cancel" }),
    ).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
