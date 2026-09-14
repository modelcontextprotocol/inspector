import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  useImportClientConfig,
  type UseImportClientConfigOptions,
} from "./useImportClientConfig";
import type { ImportSourceResult } from "@inspector/core/mcp/import/index.js";
import type { MCPConfig } from "@inspector/core/mcp/types.js";
import { ServerListReloadError } from "@inspector/core/react/useServers.js";

function config(...ids: string[]): MCPConfig {
  const mcpServers: MCPConfig["mcpServers"] = {};
  for (const id of ids) mcpServers[id] = { command: "node", args: [id] };
  return { mcpServers };
}

function foundSource(cfg: MCPConfig): ImportSourceResult {
  return { type: "claude", found: true, config: cfg, searched: ["/path"] };
}

function setup(over: Partial<UseImportClientConfigOptions> = {}) {
  const onFetchSource =
    over.onFetchSource ?? vi.fn(async () => foundSource(config("alpha")));
  const onAddServer = over.onAddServer ?? vi.fn(async () => {});
  const onUpdateServer = over.onUpdateServer ?? vi.fn(async () => {});
  const opts: UseImportClientConfigOptions = {
    opened: true,
    existingIds: [],
    onFetchSource,
    onAddServer,
    onUpdateServer,
    ...over,
  };
  const view = renderHook(
    (p: UseImportClientConfigOptions) => useImportClientConfig(p),
    { initialProps: opts },
  );
  return { ...view, onFetchSource, onAddServer, onUpdateServer };
}

describe("useImportClientConfig", () => {
  it("starts in the select phase with nothing to import", () => {
    const { result } = setup();
    expect(result.current.phase).toBe("select");
    expect(result.current.plan).toBeNull();
    expect(result.current.canImport).toBe(false);
    expect(result.current.importCount).toBe(0);
  });

  it("setSelectedType records the choice", () => {
    const { result } = setup();
    act(() => result.current.setSelectedType("claude"));
    expect(result.current.selectedType).toBe("claude");
  });

  it("pickSource loads a config and moves to review", async () => {
    const { result } = setup({
      onFetchSource: vi.fn(async () => foundSource(config("alpha", "beta"))),
    });
    await act(async () => {
      await result.current.pickSource("claude");
    });
    expect(result.current.phase).toBe("review");
    expect(result.current.plan?.additions).toHaveLength(2);
    expect(result.current.importCount).toBe(2);
    expect(result.current.canImport).toBe(true);
  });

  it("pickSource surfaces a fetch-reported error", async () => {
    const { result } = setup({
      onFetchSource: vi.fn(async () => ({
        type: "claude",
        found: false,
        searched: [],
        error: "backend blew up",
      })),
    });
    await act(async () => {
      await result.current.pickSource("claude");
    });
    expect(result.current.phase).toBe("select");
    expect(result.current.error).toBe("backend blew up");
  });

  it("pickSource shows a not-found notice", async () => {
    const { result } = setup({
      onFetchSource: vi.fn(async () => ({
        type: "claude",
        found: false,
        searched: ["/a", "/b"],
      })),
    });
    await act(async () => {
      await result.current.pickSource("claude");
    });
    expect(result.current.phase).toBe("select");
    expect(result.current.notice).toContain("No config found");
  });

  it("pickSource handles an empty config as no servers", async () => {
    const { result } = setup({
      onFetchSource: vi.fn(async () => foundSource(config())),
    });
    await act(async () => {
      await result.current.pickSource("claude");
    });
    expect(result.current.phase).toBe("select");
    expect(result.current.error).toContain("No servers found");
  });

  it("pickSource surfaces a thrown fetch error", async () => {
    const { result } = setup({
      onFetchSource: vi.fn(async () => {
        throw new Error("network down");
      }),
    });
    await act(async () => {
      await result.current.pickSource("claude");
    });
    expect(result.current.phase).toBe("select");
    expect(result.current.error).toBe("network down");
  });

  it("pickFile parses an uploaded config", async () => {
    const { result } = setup();
    const raw = JSON.stringify({ mcpServers: { gamma: { command: "go" } } });
    const file = new File([raw], "claude.json");
    await act(async () => {
      await result.current.pickFile(file);
    });
    expect(result.current.phase).toBe("review");
    expect(result.current.plan?.additions[0].id).toBe("gamma");
  });

  it("pickFile ignores a null file", async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.pickFile(null);
    });
    expect(result.current.phase).toBe("select");
  });

  it("pickFile surfaces a parse error", async () => {
    const { result } = setup();
    const file = new File(["{ not json"], "claude.json");
    await act(async () => {
      await result.current.pickFile(file);
    });
    expect(result.current.phase).toBe("select");
    expect(result.current.error).toBeTruthy();
  });

  it("runImport adds new servers and reports outcomes", async () => {
    const onAddServer = vi.fn(async () => {});
    const { result } = setup({
      onFetchSource: vi.fn(async () => foundSource(config("alpha", "beta"))),
      onAddServer,
    });
    await act(async () => {
      await result.current.pickSource("claude");
    });
    await act(async () => {
      await result.current.runImport();
    });
    expect(result.current.phase).toBe("summary");
    expect(onAddServer).toHaveBeenCalledTimes(2);
    expect(result.current.outcomes.every((o) => o.status === "added")).toBe(
      true,
    );
  });

  it("runImport skips additions opted out", async () => {
    const onAddServer = vi.fn(async () => {});
    const { result } = setup({
      onFetchSource: vi.fn(async () => foundSource(config("alpha", "beta"))),
      onAddServer,
    });
    await act(async () => {
      await result.current.pickSource("claude");
    });
    act(() => result.current.setAdditionAction("beta", "skip"));
    expect(result.current.importCount).toBe(1);
    await act(async () => {
      await result.current.runImport();
    });
    expect(onAddServer).toHaveBeenCalledTimes(1);
    expect(result.current.outcomes.find((o) => o.id === "beta")?.status).toBe(
      "skipped",
    );
  });

  it("runImport reports an addition failure", async () => {
    const onAddServer = vi.fn(async () => {
      throw new Error("add failed");
    });
    const { result } = setup({
      onFetchSource: vi.fn(async () => foundSource(config("alpha"))),
      onAddServer,
    });
    await act(async () => {
      await result.current.pickSource("claude");
    });
    await act(async () => {
      await result.current.runImport();
    });
    const outcome = result.current.outcomes[0];
    expect(outcome.status).toBe("failed");
    expect(outcome.detail).toBe("add failed");
  });

  it("reports a reload failure as imported-with-a-warning, not failed (#1914)", async () => {
    // A `ServerListReloadError` rejects *after* the write landed, so the entry
    // really was added. A red "Failed" badge would contradict the error's own
    // message and invite a retry that then collides with the row it claims
    // wasn't created. The reason still shows, as `detail`.
    const onAddServer = vi.fn(async () => {
      throw new ServerListReloadError(
        "The server was added, but the server list could not be reloaded: disk full",
      );
    });
    const { result } = setup({
      onFetchSource: vi.fn(async () => foundSource(config("alpha"))),
      onAddServer,
    });
    await act(async () => {
      await result.current.pickSource("claude");
    });
    await act(async () => {
      await result.current.runImport();
    });
    const outcome = result.current.outcomes[0];
    expect(outcome.status).toBe("added");
    expect(outcome.detail).toMatch(/could not be reloaded: disk full/);
  });

  it("resolves conflicts by overwrite, skip, and rename", async () => {
    const onAddServer = vi.fn(async () => {});
    const onUpdateServer = vi.fn(async () => {});
    const { result } = setup({
      existingIds: ["alpha", "beta", "gamma"],
      onFetchSource: vi.fn(async () =>
        foundSource(config("alpha", "beta", "gamma")),
      ),
      onAddServer,
      onUpdateServer,
    });
    await act(async () => {
      await result.current.pickSource("claude");
    });
    expect(result.current.plan?.conflicts).toHaveLength(3);
    // Default is skip for all three.
    act(() => result.current.setResolution("alpha", "overwrite"));
    act(() => result.current.setResolution("gamma", "rename"));
    act(() => result.current.setRenameTo("gamma", "gamma-new"));
    await act(async () => {
      await result.current.runImport();
    });
    expect(onUpdateServer).toHaveBeenCalledWith(
      "alpha",
      "alpha",
      expect.any(Object),
    );
    expect(onAddServer).toHaveBeenCalledWith("gamma-new", expect.any(Object));
    const statuses = Object.fromEntries(
      result.current.outcomes.map((o) => [o.id, o.status]),
    );
    expect(statuses["alpha"]).toBe("overwritten");
    expect(statuses["beta"]).toBe("skipped");
    expect(statuses["gamma-new"]).toBe("renamed");
  });

  it("flags invalid and colliding rename targets", async () => {
    const { result } = setup({
      existingIds: ["alpha", "beta"],
      onFetchSource: vi.fn(async () => foundSource(config("alpha", "beta"))),
    });
    await act(async () => {
      await result.current.pickSource("claude");
    });
    // Empty rename target.
    act(() => result.current.setResolution("alpha", "rename"));
    act(() => result.current.setRenameTo("alpha", "   "));
    expect(result.current.renameErrors["alpha"]).toContain("required");
    // Syntactically invalid.
    act(() => result.current.setRenameTo("alpha", "bad id!"));
    expect(result.current.renameErrors["alpha"]).toContain("letters");
    // Collides with the other existing id.
    act(() => result.current.setRenameTo("alpha", "beta"));
    expect(result.current.renameErrors["alpha"]).toContain("already in use");
    expect(result.current.canImport).toBe(false);
  });

  it("flags a rename target that collides with another rename", async () => {
    const { result } = setup({
      existingIds: ["alpha", "beta"],
      onFetchSource: vi.fn(async () => foundSource(config("alpha", "beta"))),
    });
    await act(async () => {
      await result.current.pickSource("claude");
    });
    act(() => result.current.setResolution("alpha", "rename"));
    act(() => result.current.setResolution("beta", "rename"));
    act(() => result.current.setRenameTo("alpha", "shared"));
    act(() => result.current.setRenameTo("beta", "shared"));
    // The collision check is symmetric — each rename sees the other's target
    // already claimed, so both must be flagged (asserting only one would pass
    // even if the check regressed to one-directional).
    expect(result.current.renameErrors["alpha"]).toContain("already in use");
    expect(result.current.renameErrors["beta"]).toContain("already in use");
    expect(result.current.canImport).toBe(false);
  });

  it("renames to the original id when the rename target is blank", async () => {
    const onAddServer = vi.fn(async () => {});
    const { result } = setup({
      existingIds: ["alpha"],
      onFetchSource: vi.fn(async () => foundSource(config("alpha"))),
      onAddServer,
    });
    await act(async () => {
      await result.current.pickSource("claude");
    });
    act(() => result.current.setResolution("alpha", "rename"));
    act(() => result.current.setRenameTo("alpha", "   "));
    // A blank rename also sets renameErrors, so canImport is false and the real
    // UI blocks submit here — this exercises the defensive fallback at
    // useImportClientConfig.ts (`res.renameTo.trim() || conflict.id`)
    // programmatically, which the UI can't reach.
    await act(async () => {
      await result.current.runImport();
    });
    // A blank rename target falls back to the original id.
    expect(onAddServer).toHaveBeenCalledWith("alpha", expect.any(Object));
    expect(result.current.outcomes[0].status).toBe("renamed");
  });

  it("back returns to the select phase", async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.pickSource("claude");
    });
    expect(result.current.phase).toBe("review");
    act(() => result.current.back());
    expect(result.current.phase).toBe("select");
  });

  it("resets when the modal is re-opened", async () => {
    const { result, rerender } = setup({ opened: false });
    const props = (opened: boolean): UseImportClientConfigOptions => ({
      opened,
      existingIds: [],
      onFetchSource: vi.fn(async () => foundSource(config("alpha"))),
      onAddServer: vi.fn(async () => {}),
      onUpdateServer: vi.fn(async () => {}),
    });
    rerender(props(true));
    await act(async () => {
      await result.current.pickSource("claude");
    });
    expect(result.current.phase).toBe("review");
    rerender(props(false));
    rerender(props(true));
    expect(result.current.phase).toBe("select");
    expect(result.current.plan).toBeNull();
  });

  it("stringifies a non-Error thrown by pickSource", async () => {
    const { result } = setup({
      onFetchSource: vi.fn(async () => {
        throw "plain fetch failure";
      }),
    });
    await act(async () => {
      await result.current.pickSource("claude");
    });
    expect(result.current.error).toBe("plain fetch failure");
  });

  it("stringifies a non-Error thrown by pickFile", async () => {
    const { result } = setup();
    const file = new File(["x"], "claude.json");
    vi.spyOn(file, "text").mockRejectedValue("plain read failure");
    await act(async () => {
      await result.current.pickFile(file);
    });
    expect(result.current.error).toBe("plain read failure");
  });

  it("stringifies a non-Error thrown while applying an import", async () => {
    const onAddServer = vi.fn(async () => {
      throw "plain add failure";
    });
    const { result } = setup({
      onFetchSource: vi.fn(async () => foundSource(config("alpha"))),
      onAddServer,
    });
    await act(async () => {
      await result.current.pickSource("claude");
    });
    await act(async () => {
      await result.current.runImport();
    });
    expect(result.current.outcomes[0]).toMatchObject({
      status: "failed",
      detail: "plain add failure",
    });
  });

  it("runImport with no plan is a no-op", async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.runImport();
    });
    expect(result.current.phase).toBe("select");
    expect(result.current.outcomes).toEqual([]);
  });
});
