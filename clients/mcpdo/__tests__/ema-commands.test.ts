import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PLAIN } from "@inspector/core/cli/style.js";
import { formatEmaStatusHuman } from "../src/connection/format-human.js";

const getEmaStatus = vi.fn();
const emaLogin = vi.fn();
const emaLogout = vi.fn();
const startPendingEmaLogin = vi.fn();

vi.mock("../src/connection/ema.js", () => ({
  getEmaStatus: (...args: unknown[]) => getEmaStatus(...args),
  emaLogin: (...args: unknown[]) => emaLogin(...args),
  emaLogout: (...args: unknown[]) => emaLogout(...args),
}));

// Mocked wholesale: the real module imports ema.js (mocked above, missing the
// loadEmaIdpConfig/requireIdp/runEmaIdpInteractiveFlow exports it needs) and
// auth-helper.js. EMA_LOGIN_HELPER_COMMAND must be the real string — mcp.ts
// registers the hidden command under it.
vi.mock("../src/connection/ema-login-helper.js", () => ({
  EMA_LOGIN_HELPER_COMMAND: "auth/complete-ema-login",
  runEmaLoginHelper: vi.fn(),
  startPendingEmaLogin: (...args: unknown[]) => startPendingEmaLogin(...args),
}));

describe("auth/ema-* commands", () => {
  let stdout: string;
  let originalStdoutWrite: typeof process.stdout.write;
  const originalStderrIsTTY = process.stderr.isTTY;
  const originalStdinIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    stdout = "";
    // Interactive path by default; individual tests flip to the non-TTY park.
    process.stderr.isTTY = true;
    originalStdoutWrite = process.stdout.write;
    process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
      stdout += typeof chunk === "string" ? chunk : String(chunk);
      const cb = rest.find((r) => typeof r === "function") as
        | (() => void)
        | undefined;
      cb?.();
      return true;
    }) as typeof process.stdout.write;
    getEmaStatus.mockReset();
    emaLogin.mockReset();
    emaLogout.mockReset();
    startPendingEmaLogin.mockReset();
  });

  afterEach(() => {
    process.stderr.isTTY = originalStderrIsTTY;
    process.stdin.isTTY = originalStdinIsTTY;
    process.stdout.write = originalStdoutWrite;
  });

  it("auth/ema-status prints the status as JSON", async () => {
    getEmaStatus.mockResolvedValue({
      clientConfigPath: "/tmp/client.json",
      configured: true,
      enabled: true,
      issuer: "https://idp.example.com",
      clientId: "idp-client",
      loginState: "logged_in",
    });
    const { runMcp } = await import("../src/connection/mcp.js");
    await runMcp(["node", "mcpdo", "auth/ema-status", "--format", "json"]);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.issuer).toBe("https://idp.example.com");
    expect(parsed.loginState).toBe("logged_in");
  });

  it("auth/ema-status prints a human summary in text mode", async () => {
    getEmaStatus.mockResolvedValue({
      clientConfigPath: "/tmp/client.json",
      configured: true,
      enabled: true,
      issuer: "https://idp.example.com",
      clientId: "idp-client",
      loginState: "none",
    });
    const { runMcp } = await import("../src/connection/mcp.js");
    await runMcp(["node", "mcpdo", "auth/ema-status"]);
    expect(stdout).toContain("EMA (enterprise-managed auth):");
    expect(stdout).toContain("https://idp.example.com");
    expect(stdout).toContain("IdP session: none");
  });

  it("auth/ema-login forwards --relogin and prints the outcome", async () => {
    emaLogin.mockResolvedValue({
      issuer: "https://idp.example.com",
      loginState: "logged_in",
      alreadyLoggedIn: false,
    });
    const { runMcp } = await import("../src/connection/mcp.js");
    await runMcp(["node", "mcpdo", "auth/ema-login", "--relogin"]);
    expect(emaLogin).toHaveBeenCalledWith({ relogin: true });
    expect(stdout).toContain("Signed in");
    expect(stdout).toContain("https://idp.example.com");
  });

  it("auth/ema-login reports an already-active connection", async () => {
    emaLogin.mockResolvedValue({
      issuer: "https://idp.example.com",
      loginState: "logged_in",
      alreadyLoggedIn: true,
    });
    const { runMcp } = await import("../src/connection/mcp.js");
    await runMcp(["node", "mcpdo", "auth/ema-login"]);
    expect(emaLogin).toHaveBeenCalledWith({ relogin: false });
    expect(stdout).toContain("Already signed in");
  });

  it("auth/ema-logout prints the signed-out issuer", async () => {
    emaLogout.mockResolvedValue({ issuer: "https://idp.example.com" });
    const { runMcp } = await import("../src/connection/mcp.js");
    await runMcp(["node", "mcpdo", "auth/ema-logout"]);
    expect(stdout).toContain("Signed out");
    expect(stdout).toContain("https://idp.example.com");
    expect(stdout).not.toContain("IdP browser session");
  });

  it("auth/ema-logout relays the IdP end-session URL when present", async () => {
    emaLogout.mockResolvedValue({
      issuer: "https://idp.example.com",
      endSessionUrl: "https://idp.example.com/session/end?id_token_hint=a.b.c",
    });
    const { runMcp } = await import("../src/connection/mcp.js");
    await runMcp(["node", "mcpdo", "auth/ema-logout"]);
    expect(stdout).toContain("Signed out");
    expect(stdout).toContain("To end your IdP browser session, navigate to:");
    expect(stdout).toContain(
      "https://idp.example.com/session/end?id_token_hint=a.b.c",
    );
  });

  it("auth/ema-login parks on a detached helper when no TTY is present", async () => {
    process.stderr.isTTY = undefined as unknown as boolean;
    process.stdin.isTTY = undefined as unknown as boolean;
    startPendingEmaLogin.mockResolvedValue({
      issuer: "https://idp.example.com",
      loginState: "none",
      alreadyLoggedIn: false,
      pendingLogin: true,
      authUrl: "https://idp.example.com/authorize?state=abc",
    });
    const { runMcp } = await import("../src/connection/mcp.js");
    await runMcp(["node", "mcpdo", "auth/ema-login"]);
    expect(startPendingEmaLogin).toHaveBeenCalledWith({ relogin: false });
    expect(emaLogin).not.toHaveBeenCalled();
    expect(stdout).toContain("Sign-in required");
    expect(stdout).toContain("https://idp.example.com/authorize?state=abc");
    expect(stdout).toContain("auth/ema-status");
    // Non-TTY: agent relay framing, same split as the connect surface.
    expect(stdout).toContain("not usable yet until the user signs in");
    expect(stdout).toContain("wait for them to confirm");
  });

  it("auth/ema-login non-TTY forwards --relogin and emits JSON with the authUrl", async () => {
    process.stderr.isTTY = undefined as unknown as boolean;
    process.stdin.isTTY = undefined as unknown as boolean;
    startPendingEmaLogin.mockResolvedValue({
      issuer: "https://idp.example.com",
      loginState: "none",
      alreadyLoggedIn: false,
      pendingLogin: true,
      authUrl: "https://idp.example.com/authorize?state=abc",
    });
    const { runMcp } = await import("../src/connection/mcp.js");
    await runMcp([
      "node",
      "mcpdo",
      "auth/ema-login",
      "--relogin",
      "--format",
      "json",
    ]);
    expect(startPendingEmaLogin).toHaveBeenCalledWith({ relogin: true });
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.pendingLogin).toBe(true);
    expect(parsed.authUrl).toBe("https://idp.example.com/authorize?state=abc");
  });

  it("auth/ema-login non-TTY short-circuit renders as already signed in", async () => {
    process.stderr.isTTY = undefined as unknown as boolean;
    process.stdin.isTTY = undefined as unknown as boolean;
    startPendingEmaLogin.mockResolvedValue({
      issuer: "https://idp.example.com",
      loginState: "logged_in",
      alreadyLoggedIn: true,
    });
    const { runMcp } = await import("../src/connection/mcp.js");
    await runMcp(["node", "mcpdo", "auth/ema-login"]);
    expect(stdout).toContain("Already signed in");
  });
});

describe("formatEmaStatusHuman", () => {
  it("renders the unconfigured state with configuration pointers", () => {
    const text = formatEmaStatusHuman(
      { clientConfigPath: "/tmp/client.json", configured: false },
      PLAIN,
    );
    expect(text).toContain("not configured");
    expect(text).toContain("/tmp/client.json");
  });

  it("renders a configured, disabled IdP without a clientId", () => {
    const text = formatEmaStatusHuman(
      {
        clientConfigPath: "/tmp/client.json",
        configured: true,
        enabled: false,
        issuer: "https://idp.example.com",
        loginState: "expired",
      },
      PLAIN,
    );
    expect(text).toContain("https://idp.example.com");
    expect(text).toContain("Enabled: no");
    expect(text).toContain("IdP session: expired");
    expect(text).not.toContain("client:");
  });

  it("highlights a live IdP session and defaults missing fields", () => {
    const loggedIn = formatEmaStatusHuman(
      {
        clientConfigPath: "/tmp/client.json",
        configured: true,
        enabled: true,
        issuer: "https://idp.example.com",
        clientId: "idp-client",
        loginState: "logged_in",
      },
      PLAIN,
    );
    expect(loggedIn).toContain("IdP session: logged_in");
    expect(loggedIn).toContain("(client: idp-client)");

    // Defensive fallbacks when a JSON payload omits optional fields.
    const sparse = formatEmaStatusHuman({ configured: true }, PLAIN);
    expect(sparse).toContain("IdP: `?`");
    expect(sparse).toContain("IdP session: none");
  });
});
