/**
 * `autoOpen` browser launch (#1959).
 *
 * Both servers call `openBrowser` from a synchronous callback — the prod
 * server from `serve()`'s listen callback, the dev plugin from `logBanner` —
 * so a rejection there has nowhere to go. On a headless or otherwise
 * browser-less host that rejection is the *ordinary* outcome, not an edge
 * case, and before #1959 it escaped as an unhandled rejection from a server
 * that had already started listening and printed a perfectly usable URL.
 *
 * The helper is shared precisely so this behavior has one implementation to
 * pin. The unit tests below cover it directly; the end-to-end test then
 * proves the prod server routes through it and survives the failure. The dev
 * plugin is not booted here — it returns early under `VITEST` by design (see
 * `vite-hono-plugin.ts`) — but it calls the same tested helper.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { createServer } from "node:net";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WebServerConfig } from "../../../../server/web-server-config.js";
import type { WebServerHandle } from "../../../../server/types.js";

const openMock = vi.hoisted(() => vi.fn());
vi.mock("open", () => ({ default: openMock }));

// Imported after the mock is registered so both bind to the double.
const { openBrowser } = await import("../../../../server/web-server-config.js");
const { startHonoServer } = await import("../../../../server/server.js");

const WARNING = "Could not open a browser automatically:";

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const { port } = addr;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("Could not resolve a free port")));
      }
    });
  });
}

/** An unhandledRejection fires on a later macrotask than the rejection. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

const INDEX_HTML =
  "<!doctype html><html><body><div id=root></div></body></html>";

let handle: WebServerHandle | undefined;
let staticRoot: string | undefined;

afterEach(async () => {
  await handle?.close();
  handle = undefined;
  if (staticRoot) await rm(staticRoot, { recursive: true, force: true });
  staticRoot = undefined;
  openMock.mockReset();
  vi.restoreAllMocks();
});

describe("openBrowser", () => {
  it("owns a rejection and warns instead of letting it go unhandled", async () => {
    // Suppress the expected warning rather than letting it pollute the run,
    // but assert on it — the warning IS the user-visible half of the fix.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const unhandled: unknown[] = [];
    const onUnhandled = (err: unknown) => unhandled.push(err);
    process.on("unhandledRejection", onUnhandled);
    try {
      openMock.mockRejectedValue(new Error("no browser on this host"));
      expect(openBrowser("http://127.0.0.1:6274")).toBeUndefined();
      await settle();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
    expect(warn).toHaveBeenCalledWith(WARNING, expect.any(Error));
  });

  it("stays quiet when the browser opens", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    openMock.mockResolvedValue(undefined);
    openBrowser("http://127.0.0.1:6274");
    await settle();
    expect(openMock).toHaveBeenCalledWith("http://127.0.0.1:6274");
    expect(warn).not.toHaveBeenCalledWith(WARNING, expect.anything());
  });
});

describe("startHonoServer autoOpen", () => {
  it("keeps serving when the browser cannot be opened", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const unhandled: unknown[] = [];
    const onUnhandled = (err: unknown) => unhandled.push(err);
    process.on("unhandledRejection", onUnhandled);

    try {
      openMock.mockRejectedValue(new Error("no browser on this host"));

      staticRoot = await mkdtemp(join(tmpdir(), "inspector-autoopen-"));
      await writeFile(join(staticRoot, "index.html"), INDEX_HTML, "utf-8");
      const port = await findFreePort();
      const baseUrl = `http://127.0.0.1:${port}`;
      const config: WebServerConfig = {
        port,
        hostname: "127.0.0.1",
        authToken: "auto-open-token",
        dangerouslyOmitAuth: false,
        initialMcpConfig: null,
        mcpConfigPath: undefined,
        writable: true,
        initialServers: null,
        storageDir: undefined,
        allowedOrigins: [baseUrl],
        sandboxPort: 0,
        appOriginPort: 0,
        sandboxHost: "127.0.0.1",
        logger: undefined,
        autoOpen: true,
        staticRoot,
      };
      handle = await startHonoServer(config);

      // `serve()`'s listen callback fires after startHonoServer resolves.
      for (let i = 0; i < 100 && openMock.mock.calls.length === 0; i++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await settle();

      expect(openMock).toHaveBeenCalledWith(expect.stringContaining(baseUrl));
      expect(unhandled).toEqual([]);
      expect(warn).toHaveBeenCalledWith(WARNING, expect.any(Error));
      // The point of warning rather than throwing: the server is still up.
      const res = await fetch(`${baseUrl}/`);
      expect(res.status).toBe(200);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
