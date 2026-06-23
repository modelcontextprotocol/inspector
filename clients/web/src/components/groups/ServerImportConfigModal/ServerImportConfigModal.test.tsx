import { describe, it, expect, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import {
  renderWithMantine,
  screen,
  waitFor,
  within,
} from "../../../test/renderWithMantine";
import type { ImportSourceResult } from "@inspector/core/mcp/import/index.js";
import { ServerImportConfigModal } from "./ServerImportConfigModal";

const sourceWithConflict: ImportSourceResult = {
  type: "cursor",
  found: true,
  path: "/home/u/.cursor/mcp.json",
  searched: ["/home/u/.cursor/mcp.json"],
  config: {
    mcpServers: {
      alpha: { type: "stdio", command: "a" },
      existing: { type: "stdio", command: "e" },
    },
  },
};

interface Handlers {
  onClose: ReturnType<typeof vi.fn>;
  onFetchSource: ReturnType<typeof vi.fn>;
  onAddServer: ReturnType<typeof vi.fn>;
  onUpdateServer: ReturnType<typeof vi.fn>;
}

function setup(
  fetchResult: ImportSourceResult | Error = sourceWithConflict,
  existingIds: string[] = ["existing"],
): Handlers & { container: HTMLElement } {
  const onClose = vi.fn();
  const onFetchSource = vi.fn(() =>
    fetchResult instanceof Error
      ? Promise.reject(fetchResult)
      : Promise.resolve(fetchResult),
  );
  const onAddServer = vi.fn().mockResolvedValue(undefined);
  const onUpdateServer = vi.fn().mockResolvedValue(undefined);
  const { container } = renderWithMantine(
    <ServerImportConfigModal
      opened
      existingIds={existingIds}
      onClose={onClose}
      onFetchSource={onFetchSource}
      onAddServer={onAddServer}
      onUpdateServer={onUpdateServer}
    />,
  );
  return { onClose, onFetchSource, onAddServer, onUpdateServer, container };
}

/** Choose a client in the source dropdown and click Import. */
async function pickClientAndImport(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
) {
  await user.selectOptions(screen.getByLabelText("Client"), label);
  await user.click(screen.getByRole("button", { name: "Import" }));
}

describe("ServerImportConfigModal", () => {
  it("renders nothing when closed", () => {
    renderWithMantine(
      <ServerImportConfigModal
        opened={false}
        existingIds={[]}
        onClose={vi.fn()}
        onFetchSource={vi.fn()}
        onAddServer={vi.fn()}
        onUpdateServer={vi.fn()}
      />,
    );
    expect(screen.queryByText("Import client config")).not.toBeInTheDocument();
  });

  it("renders a client dropdown, an Import button, and a file picker", () => {
    setup();
    // Import is disabled until a client is chosen.
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /From file/ }),
    ).toBeInTheDocument();
    // The dropdown exposes every strategy as an option.
    for (const label of ["Claude Desktop", "Cursor", "Cline", "VS Code"]) {
      expect(screen.getByRole("option", { name: label })).toBeInTheDocument();
    }
  });

  it("enables Import once a client is selected", async () => {
    const user = userEvent.setup();
    setup();
    await user.selectOptions(screen.getByLabelText("Client"), "Cursor");
    expect(screen.getByRole("button", { name: "Import" })).toBeEnabled();
  });

  it("fetches a source and shows additions + conflicts in review", async () => {
    const user = userEvent.setup();
    const h = setup();
    await pickClientAndImport(user, "Cursor");
    await waitFor(() =>
      expect(screen.getByText("New servers (1)")).toBeInTheDocument(),
    );
    expect(h.onFetchSource).toHaveBeenCalledWith("cursor");
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("Already exists (1)")).toBeInTheDocument();
    expect(screen.getByText("existing")).toBeInTheDocument();
  });

  it("imports additions and skips conflicts by default", async () => {
    const user = userEvent.setup();
    const h = setup();
    await pickClientAndImport(user, "Cursor");
    await waitFor(() => screen.getByText("New servers (1)"));
    // Default: 1 addition + 0 non-skipped conflicts.
    await user.click(screen.getByRole("button", { name: /Import 1 server/ }));
    await waitFor(() =>
      expect(screen.getByText("Import complete")).toBeInTheDocument(),
    );
    expect(h.onAddServer).toHaveBeenCalledWith("alpha", {
      type: "stdio",
      command: "a",
    });
    expect(h.onUpdateServer).not.toHaveBeenCalled();
    const addedRow = screen.getByText("alpha").parentElement as HTMLElement;
    expect(within(addedRow).getByText("Imported")).toBeInTheDocument();
    const skippedRow = screen.getByText("existing")
      .parentElement as HTMLElement;
    expect(within(skippedRow).getByText("Skipped")).toBeInTheDocument();
  });

  it("lets the user skip an individual new server", async () => {
    const user = userEvent.setup();
    setup();
    await pickClientAndImport(user, "Cursor");
    await waitFor(() => screen.getByText("New servers (1)"));
    // Toggle the new server "alpha" to Skip (its row's segmented control).
    const alphaRow = screen.getByText("alpha").parentElement as HTMLElement;
    await user.click(within(alphaRow).getByText("Skip"));
    // alpha skipped + conflict "existing" skipped by default → nothing to import.
    expect(
      screen.getByRole("button", { name: /Import 0 servers/ }),
    ).toBeDisabled();
  });

  it("skips a deselected new server while still importing others", async () => {
    const user = userEvent.setup();
    const h = setup();
    await pickClientAndImport(user, "Cursor");
    await waitFor(() => screen.getByText("New servers (1)"));
    const alphaRow = screen.getByText("alpha").parentElement as HTMLElement;
    await user.click(within(alphaRow).getByText("Skip"));
    // Overwrite the conflict so there's still one server to import.
    await user.click(screen.getByText("Overwrite"));
    await user.click(screen.getByRole("button", { name: /Import 1 server/ }));
    await waitFor(() => screen.getByText("Import complete"));
    expect(h.onAddServer).not.toHaveBeenCalled();
    expect(h.onUpdateServer).toHaveBeenCalledWith("existing", "existing", {
      type: "stdio",
      command: "e",
    });
    const alphaSummaryRow = screen.getByText("alpha")
      .parentElement as HTMLElement;
    expect(within(alphaSummaryRow).getByText("Skipped")).toBeInTheDocument();
  });

  it("overwrites a conflict when chosen", async () => {
    const user = userEvent.setup();
    const h = setup();
    await pickClientAndImport(user, "Cursor");
    await waitFor(() => screen.getByText("Already exists (1)"));
    await user.click(screen.getByText("Overwrite"));
    await user.click(screen.getByRole("button", { name: /Import 2 servers/ }));
    await waitFor(() => screen.getByText("Import complete"));
    expect(h.onUpdateServer).toHaveBeenCalledWith("existing", "existing", {
      type: "stdio",
      command: "e",
    });
  });

  it("renames a conflict to the supplied id", async () => {
    const user = userEvent.setup();
    const h = setup();
    await pickClientAndImport(user, "Cursor");
    await waitFor(() => screen.getByText("Already exists (1)"));
    await user.click(screen.getByText("Rename"));
    const renameInput = screen.getByLabelText("New id for existing");
    // Default rename value is existing-2.
    expect((renameInput as HTMLInputElement).value).toBe("existing-2");
    await user.clear(renameInput);
    await user.type(renameInput, "existing-copy");
    await user.click(screen.getByRole("button", { name: /Import 2 servers/ }));
    await waitFor(() => screen.getByText("Import complete"));
    expect(h.onAddServer).toHaveBeenCalledWith("existing-copy", {
      type: "stdio",
      command: "e",
    });
  });

  it("reports a per-server failure in the summary", async () => {
    const user = userEvent.setup();
    const h = setup();
    h.onAddServer.mockRejectedValueOnce(new Error("boom"));
    await pickClientAndImport(user, "Cursor");
    await waitFor(() => screen.getByText("New servers (1)"));
    await user.click(screen.getByRole("button", { name: /Import 1 server/ }));
    await waitFor(() => screen.getByText("Import complete"));
    const failedRow = screen.getByText("alpha").parentElement as HTMLElement;
    expect(within(failedRow).getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
  });

  it("shows the searched-paths notice when no config is found", async () => {
    const user = userEvent.setup();
    setup({
      type: "cursor",
      found: false,
      searched: ["/home/u/.cursor/mcp.json"],
    });
    await pickClientAndImport(user, "Cursor");
    await waitFor(() =>
      expect(screen.getByText(/No config found/)).toBeInTheDocument(),
    );
  });

  it("shows an error when the source has a parse error", async () => {
    const user = userEvent.setup();
    setup({
      type: "cursor",
      found: true,
      error: "Invalid JSON: bad",
      searched: ["/home/u/.cursor/mcp.json"],
    });
    await pickClientAndImport(user, "Cursor");
    await waitFor(() =>
      expect(screen.getByText(/Invalid JSON: bad/)).toBeInTheDocument(),
    );
  });

  it("shows an error when the fetch rejects", async () => {
    const user = userEvent.setup();
    setup(new Error("network down"));
    await pickClientAndImport(user, "Cursor");
    await waitFor(() =>
      expect(screen.getByText(/network down/)).toBeInTheDocument(),
    );
  });

  it("parses an uploaded file (mcpServers) into review", async () => {
    const user = userEvent.setup();
    setup();
    const file = new File(
      [JSON.stringify({ mcpServers: { fromfile: { command: "x" } } })],
      "mcp.json",
      { type: "application/json" },
    );
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await user.upload(input, file);
    await waitFor(() =>
      expect(screen.getByText("fromfile")).toBeInTheDocument(),
    );
  });

  it("parses an uploaded VS Code file (servers) into review", async () => {
    const user = userEvent.setup();
    setup();
    const file = new File(
      [JSON.stringify({ servers: { vscodesrv: { command: "x" } } })],
      "mcp.json",
      { type: "application/json" },
    );
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await user.upload(input, file);
    await waitFor(() =>
      expect(screen.getByText("vscodesrv")).toBeInTheDocument(),
    );
  });

  it("shows an error for an unparseable uploaded file", async () => {
    const user = userEvent.setup();
    setup();
    const file = new File(["{not json"], "mcp.json", {
      type: "application/json",
    });
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await user.upload(input, file);
    await waitFor(() =>
      expect(screen.getByText(/Invalid JSON/)).toBeInTheDocument(),
    );
  });

  it("reports when the selected source has no servers", async () => {
    const user = userEvent.setup();
    setup({
      type: "cursor",
      found: true,
      searched: [],
      config: { mcpServers: {} },
    });
    await pickClientAndImport(user, "Cursor");
    await waitFor(() =>
      expect(screen.getByText(/No servers found/)).toBeInTheDocument(),
    );
  });

  it("goes back from review to the source picker", async () => {
    const user = userEvent.setup();
    setup();
    await pickClientAndImport(user, "Cursor");
    await waitFor(() => screen.getByText("New servers (1)"));
    await user.click(screen.getByRole("button", { name: "Back" }));
    // Back to the source picker (dropdown + Import button).
    expect(screen.getByLabelText("Client")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import" })).toBeInTheDocument();
  });

  it("closes from the summary via Done", async () => {
    const user = userEvent.setup();
    const h = setup({
      type: "cursor",
      found: true,
      searched: [],
      config: { mcpServers: { only: { command: "x" } } },
    });
    await pickClientAndImport(user, "Cursor");
    await waitFor(() => screen.getByText("New servers (1)"));
    await user.click(screen.getByRole("button", { name: /Import 1 server/ }));
    await waitFor(() => screen.getByText("Import complete"));
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(h.onClose).toHaveBeenCalled();
  });
});
