import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const callDaemon = vi.fn();
const ensureDaemon = vi.fn();
const clearStoredAuthForRelogin = vi.fn();

// importOriginal keeps every other daemon/stored-auth export intact; only the
// two functions the disconnect path reaches are stubbed so no real daemon
// socket or OAuth-store write happens in-process.
vi.mock("../src/daemon/index.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/daemon/index.js")>()),
  callDaemon: (...args: unknown[]) => callDaemon(...args),
  ensureDaemon: (...args: unknown[]) => ensureDaemon(...args),
}));

vi.mock("../src/connection/stored-auth.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../src/connection/stored-auth.js")
  >()),
  clearStoredAuthForRelogin: (...args: unknown[]) =>
    clearStoredAuthForRelogin(...args),
}));

describe("disconnect --clear-auth", () => {
  let stdout: string;
  let originalStdoutWrite: typeof process.stdout.write;

  beforeEach(() => {
    stdout = "";
    originalStdoutWrite = process.stdout.write;
    process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
      stdout += typeof chunk === "string" ? chunk : String(chunk);
      const cb = rest.find((r) => typeof r === "function") as
        | (() => void)
        | undefined;
      cb?.();
      return true;
    }) as typeof process.stdout.write;
    callDaemon.mockReset();
    ensureDaemon.mockReset();
    clearStoredAuthForRelogin.mockReset();
    ensureDaemon.mockResolvedValue({ socketPath: "/tmp/mcpdod.sock" });
    clearStoredAuthForRelogin.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.stdout.write = originalStdoutWrite;
  });

  it("clears stored auth for the server URL the daemon returns", async () => {
    callDaemon.mockResolvedValue({
      name: "foo",
      serverUrl: "https://mcp.example.com/mcp",
    });
    const { runMcp } = await import("../src/connection/mcp.js");
    await runMcp([
      "node",
      "mcpdo",
      "disconnect",
      "--clear-auth",
      "foo",
      "--format",
      "json",
    ]);
    expect(clearStoredAuthForRelogin).toHaveBeenCalledWith(
      "https://mcp.example.com/mcp",
    );
    expect(JSON.parse(stdout.trim())).toEqual({
      name: "foo",
      clearedAuthUrl: "https://mcp.example.com/mcp",
    });
  });

  it("accepts the -c short alias", async () => {
    callDaemon.mockResolvedValue({
      name: "foo",
      serverUrl: "https://mcp.example.com/mcp",
    });
    const { runMcp } = await import("../src/connection/mcp.js");
    await runMcp([
      "node",
      "mcpdo",
      "disconnect",
      "-c",
      "foo",
      "--format",
      "json",
    ]);
    expect(clearStoredAuthForRelogin).toHaveBeenCalledWith(
      "https://mcp.example.com/mcp",
    );
    expect(JSON.parse(stdout.trim()).clearedAuthUrl).toBe(
      "https://mcp.example.com/mcp",
    );
  });

  it("does not clear auth without the flag", async () => {
    callDaemon.mockResolvedValue({
      name: "foo",
      serverUrl: "https://mcp.example.com/mcp",
    });
    const { runMcp } = await import("../src/connection/mcp.js");
    await runMcp(["node", "mcpdo", "disconnect", "foo", "--format", "json"]);
    expect(clearStoredAuthForRelogin).not.toHaveBeenCalled();
    expect(JSON.parse(stdout.trim())).toEqual({ name: "foo" });
  });

  it("is a no-op when the daemon returns no server URL (stdio)", async () => {
    callDaemon.mockResolvedValue({ name: "local" });
    const { runMcp } = await import("../src/connection/mcp.js");
    await runMcp([
      "node",
      "mcpdo",
      "disconnect",
      "--clear-auth",
      "local",
      "--format",
      "json",
    ]);
    expect(clearStoredAuthForRelogin).not.toHaveBeenCalled();
    expect(JSON.parse(stdout.trim())).toEqual({ name: "local" });
  });
});
