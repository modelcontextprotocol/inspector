import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCliOAuthNavigation,
  resolveCliAutoOpenEnabled,
} from "../src/cli-oauth-navigation.js";
import { openUrl } from "../src/open-url.js";

vi.mock("../src/open-url.js", () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

const openUrlMock = vi.mocked(openUrl);

describe("resolveCliAutoOpenEnabled", () => {
  it("honors MCP_AUTO_OPEN_ENABLED true/false and defaults off under VITEST", () => {
    expect(
      resolveCliAutoOpenEnabled({
        MCP_AUTO_OPEN_ENABLED: "true",
        VITEST: "true",
      }),
    ).toBe(true);
    expect(
      resolveCliAutoOpenEnabled({
        MCP_AUTO_OPEN_ENABLED: "false",
        VITEST: undefined,
      }),
    ).toBe(false);
    expect(resolveCliAutoOpenEnabled({ VITEST: "true" })).toBe(false);
    expect(resolveCliAutoOpenEnabled({})).toBe(true);
  });
});

describe("createCliOAuthNavigation", () => {
  afterEach(() => {
    openUrlMock.mockClear();
    openUrlMock.mockResolvedValue(undefined);
  });

  it("prints OSC 8 link and opens browser when armed on a TTY", async () => {
    const lines: string[] = [];
    const openBrowser = vi.fn().mockResolvedValue(undefined);
    const nav = createCliOAuthNavigation({
      isTTY: true,
      // Force ANSI on even when the test runner exports NO_COLOR.
      noColorEnv: "",
      write: (line) => lines.push(line),
      openBrowser,
      autoOpenControl: { armed: true },
      autoOpenEnabled: true,
    });
    const url = new URL("https://as.example/authorize?x=1");
    nav.navigateToAuthorization(url);
    await vi.waitFor(() => expect(openBrowser).toHaveBeenCalledOnce());
    expect(lines.join("")).toContain("Please navigate to:");
    expect(lines.join("")).toContain(
      "\u001b]8;;https://as.example/authorize?x=1\u0007",
    );
    expect(openBrowser).toHaveBeenCalledWith(
      "https://as.example/authorize?x=1",
    );
    expect(openUrlMock).not.toHaveBeenCalled();
  });

  it("is a silent no-op when disarmed (SDK-during-connect default)", async () => {
    const lines: string[] = [];
    const openBrowser = vi.fn();
    const nav = createCliOAuthNavigation({
      isTTY: true,
      noColorEnv: "1",
      write: (line) => lines.push(line),
      openBrowser,
      autoOpenEnabled: true,
      // no autoOpenControl → never armed
    });
    nav.navigateToAuthorization(new URL("https://as.example/authorize"));
    // Navigation is fire-and-forget; give the microtask a turn.
    await Promise.resolve();
    expect(lines).toEqual([]);
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it("is a silent no-op when disableAutoOpen is set (stored-auth-only)", async () => {
    const lines: string[] = [];
    const openBrowser = vi.fn();
    const nav = createCliOAuthNavigation({
      isTTY: true,
      noColorEnv: "1",
      write: (line) => lines.push(line),
      openBrowser,
      autoOpenControl: { armed: true },
      autoOpenEnabled: true,
      disableAutoOpen: true,
    });
    nav.navigateToAuthorization(new URL("https://as.example/authorize"));
    await Promise.resolve();
    expect(lines).toEqual([]);
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it("prints but does not open a browser when autoOpenEnabled is false", async () => {
    const lines: string[] = [];
    const openBrowser = vi.fn();
    const nav = createCliOAuthNavigation({
      isTTY: true,
      noColorEnv: "1",
      write: (line) => lines.push(line),
      openBrowser,
      autoOpenControl: { armed: true },
      autoOpenEnabled: false,
    });
    nav.navigateToAuthorization(new URL("https://as.example/authorize"));
    await vi.waitFor(() => expect(lines.length).toBe(1));
    expect(lines.join("")).toContain("Please navigate to:");
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it("prints a plain URL and does not open a browser when not a TTY", async () => {
    const lines: string[] = [];
    const openBrowser = vi.fn();
    const nav = createCliOAuthNavigation({
      isTTY: false,
      write: (line) => lines.push(line),
      openBrowser,
      autoOpenControl: { armed: true },
      autoOpenEnabled: true,
    });
    nav.navigateToAuthorization(new URL("https://as.example/authorize"));
    await vi.waitFor(() => expect(lines.length).toBe(1));
    expect(lines.join("")).toBe(
      "Please navigate to: https://as.example/authorize\n",
    );
    expect(lines.join("")).not.toContain("\u001b]8;;");
    expect(openBrowser).not.toHaveBeenCalled();
    expect(openUrlMock).not.toHaveBeenCalled();
  });

  it("skips OSC 8 when NO_COLOR is set but still opens on a TTY when armed", async () => {
    const lines: string[] = [];
    const openBrowser = vi.fn().mockResolvedValue(undefined);
    const nav = createCliOAuthNavigation({
      isTTY: true,
      noColorEnv: "1",
      write: (line) => lines.push(line),
      openBrowser,
      autoOpenControl: { armed: true },
      autoOpenEnabled: true,
    });
    nav.navigateToAuthorization(new URL("https://as.example/a"));
    await vi.waitFor(() => expect(openBrowser).toHaveBeenCalledOnce());
    expect(lines.join("")).toBe("Please navigate to: https://as.example/a\n");
    expect(lines.join("")).not.toContain("\u001b]8;;");
  });

  it("swallows browser-open failures after printing the URL", async () => {
    const lines: string[] = [];
    const openBrowser = vi.fn().mockRejectedValue(new Error("no browser"));
    const nav = createCliOAuthNavigation({
      isTTY: true,
      noColorEnv: "1",
      write: (line) => lines.push(line),
      openBrowser,
      autoOpenControl: { armed: true },
      autoOpenEnabled: true,
    });
    nav.navigateToAuthorization(new URL("https://as.example/a"));
    await vi.waitFor(() => expect(openBrowser).toHaveBeenCalledOnce());
    expect(lines.join("")).toContain("Please navigate to:");
  });

  it("writes to stderr and uses openUrl by default when armed on a TTY", async () => {
    const writeSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const ttyDesc = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");
    Object.defineProperty(process.stderr, "isTTY", {
      configurable: true,
      get: () => true,
    });
    try {
      const nav = createCliOAuthNavigation({
        noColorEnv: "1",
        autoOpenControl: { armed: true },
        autoOpenEnabled: true,
      });
      nav.navigateToAuthorization(new URL("https://as.example/default"));
      await vi.waitFor(() => expect(openUrlMock).toHaveBeenCalledOnce());
      expect(openUrlMock).toHaveBeenCalledWith("https://as.example/default");
      const written = writeSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(written).toContain(
        "Please navigate to: https://as.example/default",
      );
    } finally {
      writeSpy.mockRestore();
      if (ttyDesc) {
        Object.defineProperty(process.stderr, "isTTY", ttyDesc);
      }
    }
  });
});
