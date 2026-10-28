import { describe, it, expect, afterEach } from "vitest";
import { runCli } from "./helpers/cli-runner.js";
import {
  startThrottlingServer,
  type ThrottlingServer,
} from "./helpers/throttling-server.js";
import { EXIT_CODES } from "@inspector/core/cli/error-handler.js";

/**
 * The one-shot CLI's JSON error envelope for a throttled request (#2772),
 * end to end: a real `429` from a real server, through `InspectorClient`'s
 * rate-limit annotation, out of the CLI's own error path.
 */
describe("rate-limited request envelope", () => {
  let server: ThrottlingServer | undefined;

  afterEach(async () => {
    await server?.stop();
    server = undefined;
  });

  async function listTools(retryAfter: string | undefined) {
    server = await startThrottlingServer(retryAfter);
    const result = await runCli([
      server.url,
      "--cli",
      "--transport",
      "http",
      "--method",
      "tools/list",
      "--format",
      "json",
    ]);
    const lastLine = result.stderr.trim().split("\n").at(-1) ?? "";
    const { error } = JSON.parse(lastLine) as {
      error: Record<string, unknown>;
    };
    return { exitCode: result.exitCode, error };
  }

  it("carries the method and the server's retry timing", async () => {
    const { exitCode, error } = await listTools("30");
    expect(exitCode).toBe(EXIT_CODES.RATE_LIMITED);
    expect(error).toMatchObject({
      code: "rate_limited",
      status: 429,
      method: "tools/list",
      retryAfter: "30",
      retryAfterMs: 30_000,
    });
    expect(error.message).toContain("Rate limited by the server (HTTP 429)");
  });

  it("reports a malformed Retry-After verbatim, with no retryAfterMs", async () => {
    const { error } = await listTools("soon");
    expect(error).toMatchObject({ code: "rate_limited", retryAfter: "soon" });
    expect(error).not.toHaveProperty("retryAfterMs");
  });

  it("omits both retry fields when the server sent no header", async () => {
    const { exitCode, error } = await listTools(undefined);
    expect(exitCode).toBe(EXIT_CODES.RATE_LIMITED);
    expect(error).toMatchObject({ code: "rate_limited", method: "tools/list" });
    expect(error).not.toHaveProperty("retryAfter");
    expect(error).not.toHaveProperty("retryAfterMs");
  });
});
