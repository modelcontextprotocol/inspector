import { describe, it, expect, vi, afterEach } from "vitest";
import {
  CliExitCodeError,
  EXIT_CODES,
  classifyError,
  formatErrorOutput,
  handleError,
} from "../src/error-handler.js";

/**
 * `handleError` is the binary's last-resort error sink (wired up in
 * `src/index.ts`). It is exercised in-process here — rather than only through
 * the spawned binary — so its source is measured under the CLI coverage gate
 * (#1484). `process.exit` is stubbed so asserting on it doesn't tear down the
 * test worker.
 */
describe("handleError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits a JSON error envelope on stderr and exits with the classified code", () => {
    const writeSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((() => true) as never);
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);

    handleError(new Error("boom"));

    expect(exitSpy).toHaveBeenCalledWith(EXIT_CODES.USAGE);
    const written = writeSpy.mock.calls[0]![0] as string;
    const parsed = JSON.parse(written) as {
      error: { code: string; message: string };
    };
    expect(parsed.error.code).toBe("error");
    expect(parsed.error.message).toBe("boom");
  });

  it("uses a CliExitCodeError's exitCode and envelope code", () => {
    vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);

    handleError(
      new CliExitCodeError(EXIT_CODES.NO_APP, "no app", { code: "no_app" }),
    );

    expect(exitSpy).toHaveBeenCalledWith(EXIT_CODES.NO_APP);
  });
});

describe("classifyError", () => {
  it("classifies a 401 status as AUTH_REQUIRED", () => {
    const err = Object.assign(new Error("Unauthorized"), { status: 401 });
    const { exitCode, envelope } = classifyError(err, {
      url: "https://x.example/mcp",
    });
    expect(exitCode).toBe(EXIT_CODES.AUTH_REQUIRED);
    expect(envelope.code).toBe("auth_required");
    expect(envelope.status).toBe(401);
    expect(envelope.url).toBe("https://x.example/mcp");
  });

  it("classifies a WWW-Authenticate message as AUTH_REQUIRED without a status", () => {
    const { exitCode } = classifyError(
      new Error("Dynamic client registration failed: WWW-Authenticate Bearer"),
    );
    expect(exitCode).toBe(EXIT_CODES.AUTH_REQUIRED);
  });

  it("classifies ENOTFOUND / fetch failed as UNREACHABLE", () => {
    const err = new Error("fetch failed");
    (err as { cause?: unknown }).cause = new Error(
      "getaddrinfo ENOTFOUND no.such.host",
    );
    const { exitCode, envelope } = classifyError(err);
    expect(exitCode).toBe(EXIT_CODES.UNREACHABLE);
    expect(envelope.cause).toContain("ENOTFOUND");
  });

  it("classifies a connection-refused cause as UNREACHABLE", () => {
    const err = new Error("connect ECONNREFUSED 127.0.0.1:1");
    expect(classifyError(err).exitCode).toBe(EXIT_CODES.UNREACHABLE);
  });

  it("falls back to USAGE for an unrecognized Error", () => {
    expect(classifyError(new Error("something else")).exitCode).toBe(
      EXIT_CODES.USAGE,
    );
  });

  it("handles a string error", () => {
    const { exitCode, envelope } = classifyError("plain failure");
    expect(exitCode).toBe(EXIT_CODES.USAGE);
    expect(envelope.message).toBe("plain failure");
  });

  it("handles a non-Error, non-string value", () => {
    const { envelope } = classifyError({ unexpected: true });
    expect(envelope.message).toBe("Unknown error");
  });

  it("preserves a CliExitCodeError's explicit envelope code over the default", () => {
    const { envelope } = classifyError(
      new CliExitCodeError(EXIT_CODES.TOOL_ERROR, "x", {
        code: "tool_not_found",
      }),
    );
    expect(envelope.code).toBe("tool_not_found");
  });

  it("derives a default envelope code for a bare CliExitCodeError", () => {
    expect(
      classifyError(new CliExitCodeError(EXIT_CODES.UNREACHABLE, "x")).envelope
        .code,
    ).toBe("unreachable");
    expect(
      classifyError(new CliExitCodeError(EXIT_CODES.NO_APP, "x")).envelope.code,
    ).toBe("no_app");
    expect(
      classifyError(new CliExitCodeError(EXIT_CODES.AUTH_REQUIRED, "x"))
        .envelope.code,
    ).toBe("auth_required");
    expect(
      classifyError(new CliExitCodeError(EXIT_CODES.TOOL_ERROR, "x")).envelope
        .code,
    ).toBe("tool_error");
    expect(
      classifyError(new CliExitCodeError(EXIT_CODES.USAGE, "x")).envelope.code,
    ).toBe("error");
  });

  it("captures a non-Error cause as a string", () => {
    const err = new Error("outer");
    (err as { cause?: unknown }).cause = { reason: "blocked" };
    const { envelope } = classifyError(err);
    expect(envelope.cause).toBe("[object Object]");
  });

  it("reads a numeric SDK-style .code as an HTTP status", () => {
    const err = Object.assign(new Error("forbidden"), { code: 403 });
    const { exitCode, envelope } = classifyError(err);
    expect(exitCode).toBe(EXIT_CODES.AUTH_REQUIRED);
    expect(envelope.status).toBe(403);
  });
});

describe("formatErrorOutput", () => {
  it("emits one JSON line on stderr ending in a newline", () => {
    const { stderr, exitCode } = formatErrorOutput(new Error("nope"));
    expect(stderr.endsWith("\n")).toBe(true);
    expect(stderr.split("\n").length).toBe(2);
    const parsed = JSON.parse(stderr) as { error: { message: string } };
    expect(parsed.error.message).toBe("nope");
    expect(exitCode).toBe(EXIT_CODES.USAGE);
  });
});
