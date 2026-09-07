import { describe, it, expect, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import {
  createTestServerHttp,
  type TestServerHttp,
  createTestServerInfo,
  loadConfig,
  resolveConfig,
} from "@modelcontextprotocol/inspector-test-server";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Live coverage of `ServerConfig.strictPort` (#2280).
 *
 * Every other fixture walks to the next free port on `EADDRINUSE`, which is
 * right for them and wrong for one: `oauth-insecure-token-endpoint-http.json`
 * hard-codes its port inside an OAuth issuer string, so a relocated server would
 * announce 8092 while all its metadata still pointed at whatever unrelated
 * process holds 8091 — and would silently stop reproducing the refusal it
 * exists for. This asserts the walk still happens by default and does not
 * happen for that fixture, because "fails loudly" is only a safety property if
 * it actually fails.
 */
const configsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../../test-servers/configs",
);

describe("strictPort (#2280)", () => {
  let squatter: Server | null = null;
  let server: TestServerHttp | null = null;

  afterEach(async () => {
    if (server) {
      try {
        await server.stop();
      } catch {
        // ignore
      }
      server = null;
    }
    if (squatter) {
      await new Promise<void>((resolve) => squatter!.close(() => resolve()));
      squatter = null;
    }
  });

  /** Hold a port so the next bind has to decide whether to walk. */
  const squat = async (): Promise<number> => {
    squatter = createServer((_req, res) => res.end());
    await new Promise<void>((resolve) =>
      squatter!.listen(0, "127.0.0.1", () => resolve()),
    );
    const address = squatter.address();
    if (typeof address !== "object" || address === null) {
      throw new Error("no port");
    }
    return address.port;
  };

  it("walks to another port by default", async () => {
    const taken = await squat();
    server = createTestServerHttp({
      serverInfo: createTestServerInfo("walks", "1.0.0"),
      serverType: "streamable-http",
      port: taken,
    });
    const bound = await server.start();
    expect(bound).not.toBe(taken);
  });

  it("refuses to relocate when strictPort is set", async () => {
    const taken = await squat();
    server = createTestServerHttp({
      serverInfo: createTestServerInfo("strict", "1.0.0"),
      serverType: "streamable-http",
      port: taken,
      strictPort: true,
    });
    await expect(server.start()).rejects.toMatchObject({
      code: "EADDRINUSE",
    });
    // Deliberately NOT nulled: `start()` installs the process-global test-server
    // control before it binds, and only `stop()` clears it. Dropping the
    // reference here would skip teardown and leave that global pointing at a
    // dead server for the rest of the worker.
  });

  it.each([undefined, 0])(
    "refuses to start with strictPort and port %j",
    async (port) => {
      // Nothing to be strict about. Falling through to an OS-assigned port
      // would let a misconfigured fixture look strict while relocating every
      // run — the failure the flag exists to prevent, now silent.
      server = createTestServerHttp({
        serverInfo: createTestServerInfo("misconfigured", "1.0.0"),
        serverType: "streamable-http",
        port,
        strictPort: true,
      });
      await expect(server.start()).rejects.toThrow(
        /strictPort requires an explicit non-zero port/,
      );
    },
  );

  it("is carried from the fixture's config file to the resolved server config", async () => {
    // The plumbing half: a flag the loader drops would leave the fixture
    // relocating again with nothing to show for it.
    const resolved = resolveConfig(
      loadConfig(
        path.join(configsDir, "oauth-insecure-token-endpoint-http.json"),
      ),
    );
    expect(resolved.strictPort).toBe(true);
    expect(resolved.port).toBe(8091);
    expect(resolved.oauth?.issuerUrl?.href).toContain("localhost.:8091");
  });
});
