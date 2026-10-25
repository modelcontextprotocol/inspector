import { describe, it, expect, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SdkErrorCode, SdkHttpError } from "@modelcontextprotocol/client";
import { annotateRateLimit } from "@inspector/core/mcp/rateLimit.js";
import {
  CliExitCodeError,
  EXIT_CODES,
} from "@inspector/core/cli/error-handler.js";
import { DaemonServer } from "../src/daemon/server.js";
import { callDaemon, relayedEnvelope } from "../src/daemon/client.js";
import { runMcp } from "./helpers/mcp-runner.js";
import {
  startThrottlingServer,
  type ThrottlingServer,
} from "../../cli/__tests__/helpers/throttling-server.js";
import { expectCliSuccess } from "../../cli/__tests__/helpers/assertions.js";

/**
 * mcpdo's JSON error envelope for a throttled request (#2772). The envelope is
 * built by the shared `core/cli/error-handler.ts`, but mcpdo's failure crosses
 * the daemon socket first, so these tests cover that hop on each side and then
 * the whole path end to end.
 */
describe("mcpdo rate-limited request envelope", () => {
  let dir: string | undefined;
  let server: DaemonServer | undefined;
  let throttling: ThrottlingServer | undefined;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (server) {
      await server.stop("stop");
      server = undefined;
    }
    if (dir) {
      const socketPath = path.join(dir, "mcpdod.sock");
      if (fs.existsSync(socketPath)) {
        try {
          await callDaemon("daemon/stop", {}, { socketPath, timeoutMs: 2000 });
        } catch {
          // already stopped
        }
      }
      fs.rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
    await throttling?.stop();
    throttling = undefined;
  });

  function freshDir(): string {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcpdo-429-"));
    return dir;
  }

  function annotated429(): unknown {
    const err = new SdkHttpError(
      SdkErrorCode.ClientHttpNotImplemented,
      "Error POSTing to endpoint: slow down",
      { status: 429, retryAfter: "30" },
    );
    return annotateRateLimit(err, "tools/list");
  }

  it("relays a classified 429's structured fields on the daemon error body", async () => {
    server = new DaemonServer({ dir: freshDir(), idleMs: 0 });
    vi.spyOn(server.registry, "list").mockImplementationOnce(() => {
      throw annotated429();
    });
    const response = await server.handle({ id: "1", op: "connections/list" });
    expect(response.ok).toBe(false);
    if (response.ok) return;
    expect(response.error).toMatchObject({
      code: "rate_limited",
      exitCode: EXIT_CODES.RATE_LIMITED,
      status: 429,
      method: "tools/list",
      retryAfter: "30",
      retryAfterMs: 30_000,
    });
  });

  it("relays a pre-classified error's envelope fields, and only those present", async () => {
    server = new DaemonServer({ dir: freshDir(), idleMs: 0 });
    vi.spyOn(server.registry, "list").mockImplementationOnce(() => {
      throw new CliExitCodeError(EXIT_CODES.AUTH_REQUIRED, "denied", {
        code: "auth_required",
        status: 401,
      });
    });
    const response = await server.handle({ id: "1", op: "connections/list" });
    expect(response.ok).toBe(false);
    if (response.ok) return;
    expect(response.error).toEqual({
      code: "auth_required",
      message: "denied",
      exitCode: EXIT_CODES.AUTH_REQUIRED,
      status: 401,
    });
  });

  it("rebuilds the relayed fields on the client, sanitizing the header text", () => {
    expect(
      relayedEnvelope({
        code: "rate_limited",
        message: "m",
        status: 429,
        method: "tools/list",
        retryAfter: "30\u001b[2J",
        retryAfterMs: 30_000,
      }),
    ).toEqual({
      code: "rate_limited",
      status: 429,
      method: "tools/list",
      retryAfter: "30␛[2J",
      retryAfterMs: 30_000,
    });
    expect(relayedEnvelope({ code: "error", message: "m" })).toEqual({
      code: "error",
    });
  });

  it("writes the structured fields end to end through the daemon", async () => {
    throttling = await startThrottlingServer("30");
    const d = freshDir();
    const env = {
      MCP_STORAGE_DIR: d,
      MCP_INSPECTOR_DAEMON_DIR: d,
      MCP_ALLOW_DEFAULT_CONNECTION: "1",
    };
    const connected = await runMcp(
      [
        "connect",
        throttling.url,
        "--connection",
        "throttled",
        "--format",
        "json",
      ],
      { env, timeout: 20000 },
    );
    expectCliSuccess(connected);

    const listed = await runMcp(["tools/list", "--format", "json"], {
      env,
      timeout: 20000,
    });
    expect(listed.exitCode).toBe(EXIT_CODES.RATE_LIMITED);
    const lastLine = listed.stderr.trim().split("\n").at(-1) ?? "";
    const { error } = JSON.parse(lastLine) as {
      error: Record<string, unknown>;
    };
    expect(error).toMatchObject({
      code: "rate_limited",
      status: 429,
      method: "tools/list",
      retryAfter: "30",
      retryAfterMs: 30_000,
    });
    expect(error.message).toContain("Rate limited by the server (HTTP 429)");
  });
});
