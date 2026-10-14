import { describe, it, expect, vi, afterEach } from "vitest";
import type { MCPServerConfig } from "@inspector/core/mcp/types.js";
import { CLI_CONNECTION_TIMEOUT_REMEDY } from "@inspector/core/cli/handlers/connect-timeout.js";

const connectSpy = vi.fn();
const disconnectSpy = vi.fn().mockResolvedValue(undefined);
const navigationSpy = vi.fn();
const clientCtorSpy = vi.fn();
const createProxyFetchSpy = vi.fn<() => typeof fetch | undefined>();

vi.mock("@inspector/core/cli/cliOAuth.js", () => ({
  connectInspectorWithOAuth: (...args: unknown[]) => connectSpy(...args),
}));

vi.mock("@inspector/core/cli/cli-oauth-navigation.js", () => ({
  createCliOAuthNavigation: (...args: unknown[]) => {
    navigationSpy(...args);
    return { navigate: vi.fn() };
  },
}));

vi.mock("@inspector/core/mcp/index.js", () => ({
  InspectorClient: class {
    constructor(...args: unknown[]) {
      clientCtorSpy(...args);
    }
    connect = vi.fn();
    disconnect = disconnectSpy;
  },
}));

vi.mock("@inspector/core/mcp/node/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@inspector/core/mcp/node/index.js")>();
  return { ...actual, createProxyFetch: () => createProxyFetchSpy() };
});

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
    navigationSpy.mockClear();
    clientCtorSpy.mockClear();
    createProxyFetchSpy.mockReset();
  });

  it("installs the proxy-aware fetch on the client environment (#2642)", async () => {
    // `InspectorClient` always hands its transport a defined fetch, so the
    // environment is the only place a proxy can go for OAuth discovery and
    // token requests to reach it.
    connectSpy.mockResolvedValue(undefined);
    const proxyFetch: typeof fetch = vi.fn<typeof fetch>(); // a stand-in, never called
    createProxyFetchSpy.mockReturnValue(proxyFetch);
    const { authorizeInFrontend } =
      await import("../src/connection/authorize.js");
    await authorizeInFrontend(
      { type: "streamable-http", url: "https://example.com/mcp" },
      undefined,
    );
    const options = clientCtorSpy.mock.calls[0]?.[1] as {
      environment: { fetch?: typeof fetch };
    };
    expect(options.environment.fetch).toBe(proxyFetch);
  });

  it("names the CLI's timeout knobs, not the web's Server Settings (#2615)", async () => {
    connectSpy.mockResolvedValue(undefined);
    const { authorizeInFrontend } =
      await import("../src/connection/authorize.js");
    await authorizeInFrontend(
      { type: "streamable-http", url: "https://example.com/mcp" },
      undefined,
    );
    const options = clientCtorSpy.mock.calls[0]?.[1] as {
      connectionTimeoutRemedy?: string;
    };
    expect(options.connectionTimeoutRemedy).toBe(CLI_CONNECTION_TIMEOUT_REMEDY);
  });

  it("no-ops for non-OAuth-capable (stdio) configs", async () => {
    const { authorizeInFrontend } =
      await import("../src/connection/authorize.js");
    await authorizeInFrontend(
      { type: "stdio", command: "x" } as MCPServerConfig,
      undefined,
    );
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it("runs connectInspectorWithOAuth for HTTP configs", async () => {
    connectSpy.mockResolvedValue(undefined);
    const { authorizeInFrontend } =
      await import("../src/connection/authorize.js");
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
    const { authorizeInFrontend } =
      await import("../src/connection/authorize.js");
    await expect(
      authorizeInFrontend(
        { type: "streamable-http", url: "https://example.com/mcp" },
        undefined,
      ),
    ).resolves.toBeUndefined();
  });

  it("always admits interactive OAuth (isTTY: true), regardless of the real TTY state", async () => {
    connectSpy.mockResolvedValue(undefined);
    const { authorizeInFrontend } =
      await import("../src/connection/authorize.js");
    await authorizeInFrontend(
      { type: "streamable-http", url: "https://example.com/mcp" },
      undefined,
    );
    const options = connectSpy.mock.calls[0]?.[5] as { isTTY?: boolean };
    expect(options.isTTY).toBe(true);
  });

  it("addresses the printed authorization line to whoever must relay it — a human directly, or an agent on behalf of one", async () => {
    connectSpy.mockResolvedValue(undefined);
    const { authorizeInFrontend } =
      await import("../src/connection/authorize.js");
    await authorizeInFrontend(
      { type: "streamable-http", url: "https://example.com/mcp" },
      undefined,
    );
    const navOptions = navigationSpy.mock.calls[0]?.[0] as {
      promptMessage: (hrefDisplay: string, tty: boolean) => string;
    };
    expect(navOptions.promptMessage("https://example.com/auth", true)).toBe(
      "Please navigate to: https://example.com/auth",
    );
    expect(navOptions.promptMessage("https://example.com/auth", false)).toBe(
      "The user needs to navigate to this link to authenticate: https://example.com/auth",
    );
  });

  it("rethrows non-EMA connect failures unchanged", async () => {
    connectSpy.mockRejectedValue(new Error("network down"));
    const { authorizeInFrontend } =
      await import("../src/connection/authorize.js");
    await expect(
      authorizeInFrontend(
        { type: "streamable-http", url: "https://example.com/mcp" },
        undefined,
      ),
    ).rejects.toThrow("network down");
    expect(disconnectSpy).toHaveBeenCalled();
  });

  it("uses a caller-provided navigation instead of the CLI default", async () => {
    connectSpy.mockResolvedValue(undefined);
    const makeNavigation = vi.fn().mockReturnValue({ navigate: vi.fn() });
    const { authorizeInFrontend } =
      await import("../src/connection/authorize.js");
    await authorizeInFrontend(
      { type: "streamable-http", url: "https://example.com/mcp" },
      undefined,
      { makeNavigation },
    );
    expect(makeNavigation).toHaveBeenCalledTimes(1);
    expect(navigationSpy).not.toHaveBeenCalled();
  });

  it("maps EmaClientNotConfiguredError to actionable mcpdo guidance", async () => {
    const { EmaClientNotConfiguredError } =
      await import("@inspector/core/auth/ema/clientConfigError.js");
    connectSpy.mockRejectedValue(new EmaClientNotConfiguredError("disabled"));
    const { authorizeInFrontend } =
      await import("../src/connection/authorize.js");
    await expect(
      authorizeInFrontend(
        { type: "streamable-http", url: "https://example.com/mcp" },
        undefined,
      ),
    ).rejects.toThrow(/EMA.*disabled/i);
    // Still tears the probe client down on the error path.
    expect(disconnectSpy).toHaveBeenCalled();
  });
});
