import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getTestMcpServerCommand } from "@modelcontextprotocol/inspector-test-server";
import { runCli } from "./helpers/cli-runner.js";
import { NO_SERVER_SENTINEL } from "./helpers/fixtures.js";
import {
  parseOutputFileFormat,
  renderRaw,
  renderResultForFile,
  validateOutputOptions,
  writeResultFile,
} from "@inspector/core/cli/handlers/output-file.js";
import { CliExitCodeError } from "@inspector/core/cli/error-handler.js";
import { emitResult } from "../src/handlers/emit-result.js";

/**
 * `--output <path>` / `--output-format raw|json` (#2431): the pure rules and
 * rendering are unit-tested directly; the wiring through `parseArgs` and
 * `emitResult` is driven end to end against the stdio test server.
 */

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "inspector-cli-output-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("parseOutputFileFormat", () => {
  it("accepts raw and json", () => {
    expect(parseOutputFileFormat("raw")).toBe("raw");
    expect(parseOutputFileFormat("json")).toBe("json");
  });

  it("rejects anything else", () => {
    expect(() => parseOutputFileFormat("text")).toThrow(
      "--output-format must be 'raw' or 'json'.",
    );
  });
});

describe("validateOutputOptions", () => {
  it("accepts no --output at all", () => {
    expect(() => validateOutputOptions({ method: "tools/call" })).not.toThrow();
  });

  it("rejects --output-format without --output", () => {
    expect(() =>
      validateOutputOptions({ method: "tools/call", outputFormat: "raw" }),
    ).toThrow("--output-format requires --output <path>.");
  });

  it("rejects an empty path", () => {
    expect(() =>
      validateOutputOptions({ method: "tools/call", output: "  " }),
    ).toThrow("--output requires a non-empty file path.");
  });

  it.each([
    { listStoredAuth: true },
    { printHandoff: true },
    { method: "servers/list" },
    { method: "servers/show" },
  ])("rejects a path that never calls a server (%o)", (extra) => {
    expect(() => validateOutputOptions({ output: "x.json", ...extra })).toThrow(
      "--output requires a method that calls a server",
    );
  });

  it.each([{ appInfo: true }, { verify: true }])(
    "rejects a report-emitting flag (%o)",
    (extra) => {
      expect(() =>
        validateOutputOptions({
          output: "x.json",
          method: "tools/call",
          ...extra,
        }),
      ).toThrow("--output cannot be combined with --app-info or --verify");
    },
  );

  it("rejects raw for a method with no raw payload", () => {
    expect(() =>
      validateOutputOptions({
        output: "x.txt",
        outputFormat: "raw",
        method: "tools/list",
      }),
    ).toThrow(
      "--output-format raw requires --method tools/call or resources/read",
    );
  });

  it("accepts raw for tools/call and resources/read, json for anything", () => {
    for (const method of ["tools/call", "resources/read"]) {
      expect(() =>
        validateOutputOptions({ output: "x", outputFormat: "raw", method }),
      ).not.toThrow();
    }
    expect(() =>
      validateOutputOptions({
        output: "x",
        outputFormat: "json",
        method: "tools/list",
      }),
    ).not.toThrow();
  });
});

describe("renderRaw", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

  it("joins the text of every text-bearing block, skipping the rest", () => {
    const out = renderRaw(
      {
        content: [
          { type: "text", text: "one" },
          { type: "image", data: png.toString("base64"), mimeType: "x" },
          { type: "resource", resource: { uri: "a://b", text: "two" } },
          { type: "resource_link", uri: "a://c", name: "c" },
          "not-a-block",
        ],
      },
      "tools/call",
    );
    expect(out).toBe("one\ntwo");
  });

  it("decodes a single binary block when there is no text", () => {
    const out = renderRaw(
      {
        content: [
          { type: "image", data: png.toString("base64"), mimeType: "x" },
        ],
      },
      "tools/call",
    );
    expect(Buffer.isBuffer(out) && out.equals(png)).toBe(true);
  });

  it("reads resources/read contents (text and blob)", () => {
    expect(
      renderRaw({ contents: [{ uri: "a://b", text: "hi" }] }, "resources/read"),
    ).toBe("hi");
    const blob = renderRaw(
      { contents: [{ uri: "a://b", blob: png.toString("base64") }] },
      "resources/read",
    );
    expect(Buffer.isBuffer(blob) && blob.equals(png)).toBe(true);
  });

  it("refuses a result with no payload", () => {
    try {
      renderRaw({ structuredContent: { a: 1 } }, "tools/call");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CliExitCodeError);
      expect((err as CliExitCodeError).exitCode).toBe(1);
      expect((err as CliExitCodeError).envelope?.code).toBe("output_not_raw");
      expect((err as Error).message).toContain("no text or binary content");
    }
  });

  it("refuses a single binary block that is not valid base64", () => {
    try {
      renderRaw(
        { content: [{ type: "image", data: "not!base64!?", mimeType: "x" }] },
        "tools/call",
      );
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CliExitCodeError);
      expect((err as CliExitCodeError).envelope?.code).toBe("output_not_raw");
      expect((err as Error).message).toContain("not valid base64");
    }
  });

  it("refuses several binaries with no text", () => {
    expect(() =>
      renderRaw(
        {
          content: [
            { type: "audio", data: "AA==", mimeType: "x" },
            { type: "audio", data: "AQ==", mimeType: "x" },
          ],
        },
        "tools/call",
      ),
    ).toThrow("has 2 binary blocks and no text");
  });
});

describe("renderResultForFile / writeResultFile", () => {
  it("renders json as the pretty-printed result with a trailing newline", () => {
    expect(renderResultForFile({ a: [1] }, "tools/list", "json")).toBe(
      '{\n  "a": [\n    1\n  ]\n}\n',
    );
  });

  it("defaults to json and reports what it wrote", async () => {
    const path = join(dir, "default.json");
    const written = await writeResultFile({ ok: true }, "tools/list", path);
    expect(written).toEqual({ path, format: "json", bytes: 17 });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ ok: true });
  });

  it("counts bytes of a binary payload", async () => {
    const path = join(dir, "bin.dat");
    const written = await writeResultFile(
      { content: [{ type: "image", data: "AAEC", mimeType: "x" }] },
      "tools/call",
      path,
      "raw",
    );
    expect(written.bytes).toBe(3);
    expect([...readFileSync(path)]).toEqual([0, 1, 2]);
  });

  it("maps a failed write to output_write_failed", async () => {
    const path = join(dir, "missing-dir", "x.json");
    const promise = writeResultFile({}, "tools/list", path);
    await expect(promise).rejects.toBeInstanceOf(CliExitCodeError);
    await promise.catch((err: CliExitCodeError) => {
      expect(err.exitCode).toBe(1);
      expect(err.envelope?.code).toBe("output_write_failed");
      expect(err.message).toContain(`Could not write --output file ${path}`);
    });
  });
});

describe("--output end to end", () => {
  const { command, args } = getTestMcpServerCommand();
  const echo = (...extra: string[]) =>
    runCli([
      command,
      ...args,
      "--cli",
      "--method",
      "tools/call",
      "--tool-name",
      "echo",
      "--tool-arg",
      "message=hello",
      ...extra,
    ]);

  it("writes the whole result as json, keeping stdout empty", async () => {
    const path = join(dir, "echo.json");
    const result = await echo("--output", path);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(`(json) to ${path}`);
    const saved = JSON.parse(readFileSync(path, "utf8"));
    expect(saved.content[0].text).toContain("hello");
  });

  it("writes raw text", async () => {
    const path = join(dir, "echo.txt");
    const result = await echo("--output", path, "--output-format", "raw");
    expect(result.exitCode).toBe(0);
    const text = readFileSync(path, "utf8");
    expect(text).toContain("hello");
    expect(() => JSON.parse(text)).toThrow();
  });

  it("puts an { output } envelope on stdout under --format json", async () => {
    const path = join(dir, "echo-envelope.json");
    const result = await echo("--output", path, "--format", "json");
    expect(result.exitCode).toBe(0);
    const envelope = JSON.parse(result.stdout.trim());
    expect(envelope).not.toHaveProperty("result");
    expect(envelope.output).toMatchObject({ path, format: "json" });
    expect(envelope.output.bytes).toBe(readFileSync(path).length);
  });

  it("writes only the text when a result mixes text and an image", async () => {
    const path = join(dir, "mixed.txt");
    const result = await runCli([
      command,
      ...args,
      "--cli",
      "--method",
      "tools/call",
      "--tool-name",
      "get_annotated_message",
      "--tool-arg",
      "messageType=success",
      "includeImage=true",
      "--output",
      path,
      "--output-format",
      "raw",
    ]);
    // The tool also returns a text block, so raw writes the text — the
    // binary-only path is pinned by the unit tests above.
    expect(result.exitCode).toBe(0);
    expect(readFileSync(path, "utf8").length).toBeGreaterThan(0);
  });

  it("writes resources/read text raw", async () => {
    const path = join(dir, "env.json");
    const result = await runCli([
      command,
      ...args,
      "--cli",
      "--method",
      "resources/read",
      "--uri",
      "test://env",
      "--output",
      path,
      "--output-format",
      "raw",
    ]);
    expect(result.exitCode).toBe(0);
    // The resource's own text is a JSON object of the env, written verbatim.
    expect(typeof JSON.parse(readFileSync(path, "utf8"))).toBe("object");
  });

  it("rejects --output on a catalog method before connecting", async () => {
    const result = await runCli([
      NO_SERVER_SENTINEL,
      "--cli",
      "--method",
      "servers/list",
      "--output",
      join(dir, "never.json"),
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--output requires a method that calls");
  });

  it("fails with output_write_failed when the directory is missing", async () => {
    const result = await echo("--output", join(dir, "nope", "x.json"));
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("output_write_failed");
  });
});

describe("emitResult with --output", () => {
  it("folds appInfo beside { output } and still exits TOOL_ERROR on isError", async () => {
    const path = join(dir, "is-error.json");
    let stdout = "";
    const original = process.stdout.write;
    process.stdout.write = ((chunk: unknown, ...rest: unknown[]): boolean => {
      stdout += String(chunk);
      const cb = rest.find((r) => typeof r === "function") as
        | (() => void)
        | undefined;
      cb?.();
      return true;
    }) as typeof process.stdout.write;
    try {
      const promise = emitResult(
        { content: [{ type: "text", text: "boom" }], isError: true },
        { hasApp: true, toolName: "t", resourceUri: "ui://t" },
        { toolName: "t", format: "json", output: path },
      );
      await expect(promise).rejects.toBeInstanceOf(CliExitCodeError);
      await promise.catch((err: CliExitCodeError) => {
        expect(err.exitCode).toBe(5);
      });
    } finally {
      process.stdout.write = original;
    }
    // The result is written before the exit, and method-less args fall back
    // to the json rendering.
    expect(JSON.parse(readFileSync(path, "utf8")).isError).toBe(true);
    const envelope = JSON.parse(stdout.trim());
    expect(envelope.output.path).toBe(path);
    expect(envelope.appInfo).toMatchObject({ hasApp: true });
  });
});
