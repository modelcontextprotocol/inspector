import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PLAIN } from "@inspector/cli/style.js";
import { formatEmaStatusHuman } from "../src/connection/format-human.js";

const getEmaStatus = vi.fn();
const emaLogin = vi.fn();
const emaLogout = vi.fn();

vi.mock("../src/connection/ema.js", () => ({
  getEmaStatus: (...args: unknown[]) => getEmaStatus(...args),
  emaLogin: (...args: unknown[]) => emaLogin(...args),
  emaLogout: (...args: unknown[]) => emaLogout(...args),
}));

describe("auth/ema-* commands", () => {
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
    getEmaStatus.mockReset();
    emaLogin.mockReset();
    emaLogout.mockReset();
  });

  afterEach(() => {
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
