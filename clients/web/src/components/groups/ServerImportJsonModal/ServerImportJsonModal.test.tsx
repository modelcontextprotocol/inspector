import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import {
  act,
  renderWithMantine,
  screen,
  fireEvent,
  waitFor,
} from "../../../test/renderWithMantine";
import { setAceText } from "../../../test/aceEditor";
import { VALIDATE_DEBOUNCE_MS } from "../../../hooks/useServerJsonImport";
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

/**
 * Replace the File Contents editor's document the way a paste would.
 *
 * Async because the panel's editor is Ace, which coalesces the paired
 * remove/insert events a replace fires — see `test/aceEditor.ts`.
 */
async function pasteJson(text: string) {
  await setAceText(text);
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
    expect(screen.queryByText("Validation Results")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Override")).not.toBeInTheDocument();
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
    await pasteJson(npmJson);
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
    await pasteJson("{not json");
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
    await pasteJson(npmJson);
    expect(
      await screen.findByText(/A server with id "weather" already exists/),
    ).toBeInTheDocument();
  });

  it("builds the config with env overrides and calls onAddServer", async () => {
    const user = userEvent.setup({ delay: null });
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
    await pasteJson(npmJson);
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
    const user = userEvent.setup({ delay: null });
    const onAddServer = vi.fn().mockResolvedValue(undefined);
    renderWithMantine(
      <ServerImportJsonModal
        opened
        existingIds={[]}
        onClose={vi.fn()}
        onAddServer={onAddServer}
      />,
    );
    await pasteJson(npmJson);
    await user.type(screen.getByLabelText("Override"), "my-weather");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add Server" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "Add Server" }));
    await waitFor(() => expect(onAddServer).toHaveBeenCalled());
    expect(onAddServer.mock.calls[0][0]).toBe("my-weather");
  });

  it("lets the user pick among multiple packages", async () => {
    const user = userEvent.setup({ delay: null });
    const onAddServer = vi.fn().mockResolvedValue(undefined);
    renderWithMantine(
      <ServerImportJsonModal
        opened
        existingIds={[]}
        onClose={vi.fn()}
        onAddServer={onAddServer}
      />,
    );
    await pasteJson(multiPackageJson);
    // The package radios appear after the debounced parse.
    await user.click(await screen.findByLabelText(/pypi: multi-py/));
    await user.click(screen.getByRole("button", { name: "Add Server" }));
    await waitFor(() => expect(onAddServer).toHaveBeenCalled());
    expect(onAddServer.mock.calls[0][1]).toMatchObject({ command: "uvx" });
  });

  it("surfaces an onAddServer rejection instead of closing", async () => {
    const user = userEvent.setup({ delay: null });
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
    await pasteJson(npmJson);
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

  // The window this exercises is the one between an edit and the debounce that
  // re-disables the button, so the whole test runs on fake timers: the pending
  // re-validation then cannot land unless this test advances it, and the window
  // stops depending on how long the machine takes to get from the paste to the
  // click. On real timers a loaded box could spend more than
  // VALIDATE_DEBOUNCE_MS there, re-disable the button, and turn the click into a
  // no-op that sets no submit error at all (#2250).
  it("guards against a live edit made before the debounce re-validates", async () => {
    vi.useFakeTimers();
    try {
      const onAddServer = vi.fn();
      renderWithMantine(
        <ServerImportJsonModal
          opened
          existingIds={[]}
          onClose={vi.fn()}
          onAddServer={onAddServer}
        />,
      );
      await pasteJson(npmJson);
      // Let the first validation land, so the button is enabled to click.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(VALIDATE_DEBOUNCE_MS);
      });
      expect(screen.getByRole("button", { name: "Add Server" })).toBeEnabled();
      // Replace with invalid content and do *not* advance: the debounce stays
      // pending, the button stays enabled, and clicking exercises the
      // submit-time guard that re-parses the live text.
      await pasteJson("{not json");
      fireEvent.click(screen.getByRole("button", { name: "Add Server" }));
      expect(onAddServer).not.toHaveBeenCalled();
      expect(screen.getByText(/Fix the validation errors/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("loads server.json from a chosen file", async () => {
    const user = userEvent.setup({ delay: null });
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
    await pasteJson(npmJson);
    await waitFor(
      () => expect(disclosure).toHaveAttribute("aria-expanded", "false"),
      { timeout: 3000 },
    );
  });

  it("re-opens File Contents when the textarea is cleared", async () => {
    const user = userEvent.setup({ delay: null });
    renderWithMantine(
      <ServerImportJsonModal
        opened
        existingIds={[]}
        onClose={vi.fn()}
        onAddServer={vi.fn()}
      />,
    );
    await pasteJson(npmJson);
    const disclosure = screen.getByRole("button", { name: "File Contents" });
    // Clear via the textarea's Clear button while still expanded.
    await user.click(screen.getAllByRole("button", { name: "Clear" })[0]);
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
  });

  it("rejects an invalid id override and blocks Add Server", async () => {
    const user = userEvent.setup({ delay: null });
    const onAddServer = vi.fn();
    renderWithMantine(
      <ServerImportJsonModal
        opened
        existingIds={[]}
        onClose={vi.fn()}
        onAddServer={onAddServer}
      />,
    );
    await pasteJson(npmJson);
    await user.type(screen.getByLabelText("Override"), "bad id!");
    expect(
      await screen.findByText(/Server id must use only letters/),
    ).toBeInTheDocument();
    // An invalid id keeps the Add button disabled.
    expect(screen.getByRole("button", { name: "Add Server" })).toBeDisabled();
    expect(onAddServer).not.toHaveBeenCalled();
  });

  it("closes via the Escape key (no Cancel button)", async () => {
    const user = userEvent.setup({ delay: null });
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
