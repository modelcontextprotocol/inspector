import { describe, it, expect, vi, afterEach } from "vitest";
import type { MCPServerConfig } from "@inspector/core/mcp/types.js";

const connectSpy = vi.fn();
const disconnectSpy = vi.fn().mockResolvedValue(undefined);

vi.mock("../src/cliOAuth.js", () => ({
  connectInspectorWithOAuth: (...args: unknown[]) => connectSpy(...args),
}));

vi.mock("@inspector/core/mcp/index.js", () => ({
  InspectorClient: class {
    connect = vi.fn();
    disconnect = disconnectSpy;
  },
}));

vi.mock("@inspector/core/client/runner.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@inspector/core/client/runner.js")>();
  return {
    ...actual,
    loadRunnerClientConfig: vi.fn().mockResolvedValue({}),
    buildRunnerClientAuthOptions: vi.fn().mockReturnValue({}),
  };
});

describe("authorizeInFrontend", () => {
  afterEach(() => {
    connectSpy.mockReset();
    disconnectSpy.mockClear();
  });

  it("no-ops for non-OAuth-capable (stdio) configs", async () => {
    const { authorizeInFrontend } = await import("../src/session/authorize.js");
    await authorizeInFrontend(
      { type: "stdio", command: "x" } as MCPServerConfig,
      undefined,
    );
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it("runs connectInspectorWithOAuth for HTTP configs", async () => {
    connectSpy.mockResolvedValue(undefined);
    const { authorizeInFrontend } = await import("../src/session/authorize.js");
    await authorizeInFrontend(
      { type: "streamable-http", url: "https://example.com/mcp" },
      { protocolEra: "2025-11-25" } as never,
      { storedAuthOnly: true },
    );
    expect(connectSpy).toHaveBeenCalled();
    expect(disconnectSpy).toHaveBeenCalled();
  });

  it("swallows disconnect failures in finally", async () => {
    connectSpy.mockResolvedValue(undefined);
    disconnectSpy.mockRejectedValueOnce(new Error("bye"));
    const { authorizeInFrontend } = await import("../src/session/authorize.js");
    await expect(
      authorizeInFrontend(
        { type: "streamable-http", url: "https://example.com/mcp" },
        undefined,
      ),
    ).resolves.toBeUndefined();
  });
});
