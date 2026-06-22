import { describe, it, expect, vi, afterEach } from "vitest";
import { CliExitCodeError, handleError } from "../src/error-handler.js";

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

  it("logs an Error's message and exits with code 1", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);

    handleError(new Error("boom"));

    expect(errorSpy).toHaveBeenCalledWith("boom");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("logs a string error verbatim", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    handleError("plain failure");

    expect(errorSpy).toHaveBeenCalledWith("plain failure");
  });

  it("falls back to 'Unknown error' for non-Error, non-string values", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    handleError({ unexpected: true });

    expect(errorSpy).toHaveBeenCalledWith("Unknown error");
  });

  it("uses a CliExitCodeError's exitCode instead of 1", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);

    handleError(new CliExitCodeError(2, "no app"));

    expect(exitSpy).toHaveBeenCalledWith(2);
  });
});
