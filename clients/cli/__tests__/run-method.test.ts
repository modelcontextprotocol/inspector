import { describe, it, expect, afterEach, vi } from "vitest";
import { getTestMcpServerCommand } from "@modelcontextprotocol/inspector-test-server";
import { InspectorClient } from "@inspector/core/mcp/index.js";
import { createTransportNode } from "@inspector/core/mcp/node/index.js";
import { runMethod } from "../src/handlers/run-method.js";
import { consumeMethodOutcome } from "../src/handlers/consume-outcome.js";

describe("runMethod", () => {
  let client: InspectorClient | undefined;

  afterEach(async () => {
    if (client) {
      await client.disconnect().catch(() => {});
      client = undefined;
    }
  });

  async function connectStdio(): Promise<InspectorClient> {
    const { command, args } = getTestMcpServerCommand();
    client = new InspectorClient(
      { type: "stdio", command, args },
      {
        environment: { transport: createTransportNode },
        clientIdentity: { name: "test", version: "0.0.0" },
        progress: false,
        sample: false,
        elicit: false,
        // Mirrors `cli.ts`, which always passes the option so the capability is
        // negotiated and the `roots/list` handler registered (#1797).
        roots: [],
      },
    );
    await client.connect();
    return client;
  }

  it("lists tools and reads initialize fields", async () => {
    const c = await connectStdio();
    const tools = await runMethod(c, { method: "tools/list" });
    expect(tools.kind).toBe("result");
    if (tools.kind === "result") {
      expect(
        (tools.result.tools as unknown[] | undefined)?.length,
      ).toBeGreaterThan(0);
    }

    const init = await runMethod(c, { method: "initialize" });
    expect(init.kind).toBe("result");
  });

  it("returns ndjson lines for tools/list --app-info", async () => {
    const c = await connectStdio();
    const outcome = await runMethod(c, {
      method: "tools/list",
      appInfo: true,
    });
    expect(outcome.kind).toBe("ndjson");
    if (outcome.kind === "ndjson") {
      expect(outcome.lines.length).toBeGreaterThan(0);
    }
  });

  it("lists resources and prompts", async () => {
    const c = await connectStdio();
    const resources = await runMethod(c, { method: "resources/list" });
    expect(resources.kind).toBe("result");
    const prompts = await runMethod(c, { method: "prompts/list" });
    expect(prompts.kind).toBe("result");
    const templates = await runMethod(c, {
      method: "resources/templates/list",
    });
    expect(templates.kind).toBe("result");
  });

  it("sets logging level", async () => {
    const c = await connectStdio();
    const outcome = await runMethod(c, {
      method: "logging/setLevel",
      logLevel: "info",
    });
    expect(outcome.kind).toBe("result");
  });

  it("roots/list and roots/set round-trip", async () => {
    const c = await connectStdio();
    const listed = await runMethod(c, { method: "roots/list" });
    expect(listed.kind).toBe("result");
    const set = await runMethod(c, {
      method: "roots/set",
      rootsJson: JSON.stringify([{ uri: "file:///tmp", name: "tmp" }]),
    });
    expect(set.kind).toBe("result");
    if (set.kind === "result") {
      expect(set.result.roots).toEqual([{ uri: "file:///tmp", name: "tmp" }]);
    }
  });

  it("roots/set drops a malformed root rather than advertising it", async () => {
    // `--roots-json` only checks that the payload parses to an array, so a
    // root with no `uri` used to be stored and then handed to the server in
    // the `roots/list` reply — an invalid Root on the wire, echoed back to the
    // user as success. `setRoots` normalizes through `cleanRoots` now (#1797).
    const c = await connectStdio();
    // cleanRoots reports the drop; suppress it here and assert it happened, so
    // the test also covers that a dropped root is not dropped silently.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const set = await runMethod(c, {
        method: "roots/set",
        rootsJson: JSON.stringify([
          { name: "no uri" },
          { uri: "file:///keep" },
        ]),
      });
      expect(set.kind).toBe("result");
      if (set.kind === "result") {
        expect(set.result.roots).toEqual([{ uri: "file:///keep" }]);
      }
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("consumeMethodOutcome writes result json", async () => {
    let stdout = "";
    const original = process.stdout.write;
    process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
      stdout += typeof chunk === "string" ? chunk : String(chunk);
      const cb = rest.find((r) => typeof r === "function") as
        | (() => void)
        | undefined;
      cb?.();
      return true;
    }) as typeof process.stdout.write;
    try {
      await consumeMethodOutcome(
        { kind: "result", result: { ok: true } },
        { format: "json" },
      );
      expect(JSON.parse(stdout.trim())).toEqual({ result: { ok: true } });
    } finally {
      process.stdout.write = original;
    }
  });

  it("rejects unknown methods", async () => {
    const c = await connectStdio();
    await expect(runMethod(c, { method: "nope/method" })).rejects.toThrow(
      /Unsupported method/,
    );
  });

  it("calls echo tool and rejects missing tool name", async () => {
    const c = await connectStdio();
    await expect(runMethod(c, { method: "tools/call" })).rejects.toThrow(
      /Tool name is required/,
    );

    const missing = runMethod(c, {
      method: "tools/call",
      toolName: "does-not-exist",
    });
    await expect(missing).rejects.toMatchObject({ exitCode: 5 });

    const called = await runMethod(c, {
      method: "tools/call",
      toolName: "echo",
      toolArg: { message: "hi" },
      format: "json",
    });
    expect(called.kind).toBe("result");
  });

  it("reads a resource and gets a prompt", async () => {
    const c = await connectStdio();
    const read = await runMethod(c, {
      method: "resources/read",
      uri: "test://env",
    });
    expect(read.kind).toBe("result");

    await expect(runMethod(c, { method: "resources/read" })).rejects.toThrow(
      /URI is required/,
    );

    const prompts = await runMethod(c, { method: "prompts/list" });
    expect(prompts.kind).toBe("result");
    if (prompts.kind === "result") {
      const list = prompts.result.prompts as { name: string }[];
      if (list.length > 0) {
        const got = await runMethod(c, {
          method: "prompts/get",
          promptName: list[0]!.name,
        });
        expect(got.kind).toBe("result");
      }
    }
  });

  it("returns a stream starter for logging/tail", async () => {
    const c = await connectStdio();
    const outcome = await runMethod(c, { method: "logging/tail" });
    expect(outcome.kind).toBe("stream");
    if (outcome.kind === "stream") {
      const stop = outcome.start(() => {});
      stop();
    }
  });

  it("requires uri for subscribe/unsubscribe", async () => {
    const c = await connectStdio();
    await expect(
      runMethod(c, { method: "resources/subscribe" }),
    ).rejects.toThrow(/URI is required/);
    await expect(
      runMethod(c, { method: "resources/unsubscribe" }),
    ).rejects.toThrow(/URI is required/);
  });

  it("rejects bad roots/set JSON and missing logging level", async () => {
    const c = await connectStdio();
    await expect(runMethod(c, { method: "logging/setLevel" })).rejects.toThrow(
      /Log level is required/,
    );
    await expect(
      runMethod(c, { method: "roots/set", rootsJson: "{}" }),
    ).rejects.toThrow(/must be a JSON array/);
    await expect(runMethod(c, { method: "roots/set" })).rejects.toThrow(
      /roots\/set requires/,
    );
    await expect(runMethod(c, { method: "tasks/get" })).rejects.toThrow(
      /Task id is required/,
    );
    await expect(runMethod(c, { method: "prompts/get" })).rejects.toThrow(
      /Prompt name is required/,
    );
    await expect(runMethod(c, { method: "prompts/complete" })).rejects.toThrow(
      /prompts\/complete requires/,
    );
  });

  it("consumeMethodOutcome writes ndjson and stream until SIGINT", async () => {
    let stdout = "";
    const original = process.stdout.write;
    process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
      stdout += typeof chunk === "string" ? chunk : String(chunk);
      const cb = rest.find((r) => typeof r === "function") as
        | (() => void)
        | undefined;
      cb?.();
      return true;
    }) as typeof process.stdout.write;
    try {
      await consumeMethodOutcome(
        { kind: "ndjson", lines: [{ a: 1 }, { b: 2 }] },
        {},
      );
      expect(stdout.trim().split("\n")).toHaveLength(2);

      // Invoke only the SIGINT handler consumeMethodOutcome registers, rather
      // than broadcasting `process.emit("SIGINT")` process-wide: `atomically`
      // (loaded via core's store-io) pulls in `when-exit`, whose module-level
      // `process.once("SIGINT")` handler re-raises the signal with
      // `process.kill(process.pid, "SIGINT")` — on Windows an unconditional
      // TerminateProcess that kills the vitest worker fork mid-run (#1941).
      const listenersBefore = new Set(process.listeners("SIGINT"));
      const streamPromise = consumeMethodOutcome(
        {
          kind: "stream",
          label: "t",
          start: (write) => {
            write({ hi: true });
            return () => {};
          },
        },
        {},
      );
      const added = process
        .listeners("SIGINT")
        .filter((listener) => !listenersBefore.has(listener));
      expect(added).toHaveLength(1);
      for (const listener of added) listener("SIGINT");
      await streamPromise;
      expect(stdout).toContain('"hi":true');
    } finally {
      process.stdout.write = original;
    }
  });
});
