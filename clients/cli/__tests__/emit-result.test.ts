import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { emitResult, collectAppInfo } from "../src/cli.js";
import { CliExitCodeError } from "../src/error-handler.js";
import type { InspectorClient } from "@inspector/core/mcp/index.js";

/**
 * Direct unit coverage for the two output-side branches that the end-to-end
 * CLI tests can't reach with the default stdio fixture: a tool that returns
 * `isError:true` (exit 5), and a UI-resource read that fails during an
 * `--app-info` probe (`resourceError`). Both functions are exported from
 * `cli.ts` purely for this test, mirroring the `withConnectTimeout` pattern.
 */
describe("emitResult", () => {
  let stdout: string;
  let originalWrite: typeof process.stdout.write;

  beforeEach(() => {
    stdout = "";
    originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: unknown, ...rest: unknown[]): boolean => {
      stdout += typeof chunk === "string" ? chunk : String(chunk);
      const cb = rest.find((r) => typeof r === "function") as
        | (() => void)
        | undefined;
      cb?.();
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = originalWrite;
  });

  it("uses a default appInfo shell when --app-info has no collected info", async () => {
    const promise = emitResult(undefined as never, undefined, {
      appInfo: true,
      toolName: "missing-app",
      format: "text",
    });
    await expect(promise).rejects.toBeInstanceOf(CliExitCodeError);
    await promise.catch((e: CliExitCodeError) => {
      expect(e.exitCode).toBe(2);
    });
    expect(JSON.parse(stdout.trim())).toMatchObject({
      hasApp: false,
      toolName: "missing-app",
    });
  });

  it("throws TOOL_ERROR (code:tool_is_error) when the result has isError:true", async () => {
    const promise = emitResult({ isError: true }, undefined, {
      toolName: "boom",
    });
    await expect(promise).rejects.toBeInstanceOf(CliExitCodeError);
    await promise.catch((e: CliExitCodeError) => {
      expect(e.exitCode).toBe(5);
      expect(e.envelope?.code).toBe("tool_is_error");
    });
    // The payload is still printed before the throw.
    expect(stdout).toContain("isError");
  });

  it("does not throw for a successful result (text mode)", async () => {
    await expect(
      emitResult({ ok: true }, undefined, { format: "text" }),
    ).resolves.toBeUndefined();
    expect(JSON.parse(stdout.trim())).toEqual({ ok: true });
  });

  it("wraps result + appInfo under a json envelope", async () => {
    await emitResult(
      { value: 1 },
      { hasApp: true, toolName: "t", resourceUri: "ui://x" },
      { format: "json" },
    );
    expect(JSON.parse(stdout.trim())).toEqual({
      result: { value: 1 },
      appInfo: { hasApp: true, toolName: "t", resourceUri: "ui://x" },
    });
  });
});

describe("collectAppInfo", () => {
  it("returns base info for a non-App tool without reading a resource", async () => {
    const client = {
      readResource: vi.fn(),
    } as unknown as Pick<InspectorClient, "readResource">;
    const info = await collectAppInfo(
      client,
      { name: "plain", inputSchema: { type: "object" as const } },
      undefined,
    );
    expect(info).toEqual({ hasApp: false, toolName: "plain" });
    expect(
      (client.readResource as ReturnType<typeof vi.fn>).mock.calls.length,
    ).toBe(0);
  });

  it("captures resourceError when the UI resource read fails", async () => {
    const client = {
      readResource: vi.fn().mockRejectedValue(new Error("unreadable")),
    } as unknown as Pick<InspectorClient, "readResource">;
    const tool = {
      name: "app",
      inputSchema: { type: "object" as const },
      _meta: { ui: { resourceUri: "ui://app/widget.html" } },
    };
    const info = await collectAppInfo(client, tool, undefined);
    expect(info.hasApp).toBe(true);
    expect(info.resourceUri).toBe("ui://app/widget.html");
    expect(info.resourceError).toBe("unreadable");
  });

  it("stringifies a non-Error rejection into resourceError", async () => {
    const client = {
      readResource: vi.fn().mockRejectedValue("string failure"),
    } as unknown as Pick<InspectorClient, "readResource">;
    const tool = {
      name: "app",
      inputSchema: { type: "object" as const },
      _meta: { ui: { resourceUri: "ui://app/widget.html" } },
    };
    const info = await collectAppInfo(client, tool, undefined);
    expect(info.resourceError).toBe("string failure");
  });

  it("stringifies a non-Error throw from extractAppInfo", async () => {
    const extract = await import("@inspector/core/mcp/apps.js");
    const spy = vi
      .spyOn(extract, "extractAppInfo")
      .mockImplementationOnce(() => {
        throw "boom-string";
      });
    try {
      const info = await collectAppInfo(
        { readResource: vi.fn() } as never,
        { name: "t", inputSchema: { type: "object" as const } },
        undefined,
      );
      expect(info.resourceError).toBe("boom-string");
    } finally {
      spy.mockRestore();
    }
  });

  it("folds a malformed _meta.ui.resourceUri into {hasApp:false, resourceError} instead of throwing", async () => {
    // extractAppInfo throws when the advertised UI URI is not a `ui://` string;
    // collectAppInfo must tolerate that so the tools/list --app-info NDJSON loop
    // stays per-tool robust. readResource must never be reached here.
    const readResource = vi.fn();
    const client = { readResource } as unknown as Pick<
      InspectorClient,
      "readResource"
    >;
    const tool = {
      name: "bad-app",
      inputSchema: { type: "object" as const },
      _meta: { ui: { resourceUri: "http://not-a-ui-uri" } },
    };
    const info = await collectAppInfo(client, tool, undefined);
    expect(info.hasApp).toBe(false);
    expect(info.toolName).toBe("bad-app");
    expect(typeof info.resourceError).toBe("string");
    expect(info.resourceError!.length).toBeGreaterThan(0);
    expect(readResource.mock.calls.length).toBe(0);
  });
});
