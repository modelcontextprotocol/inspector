import { describe, it, expect, afterEach } from "vitest";
import { writeFormattedResult } from "../src/handlers/format-output.js";

describe("writeFormattedResult", () => {
  let originalWrite: typeof process.stdout.write;

  afterEach(() => {
    if (originalWrite) process.stdout.write = originalWrite;
  });

  function captureStdout(): { get: () => string; restore: () => void } {
    let out = "";
    originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
      out += String(chunk);
      const cb = rest.find((x) => typeof x === "function") as
        | (() => void)
        | undefined;
      cb?.();
      return true;
    }) as typeof process.stdout.write;
    return {
      get: () => out,
      restore: () => {
        process.stdout.write = originalWrite;
      },
    };
  }

  it("defaults to pretty text and supports the json envelope", async () => {
    const cap = captureStdout();
    try {
      await writeFormattedResult({ ok: 1 });
      expect(cap.get()).toContain('"ok": 1');
      expect(cap.get()).not.toContain('"result"');

      // reset buffer by re-capturing
      cap.restore();
      const cap2 = captureStdout();
      try {
        await writeFormattedResult({ ok: 2 }, "json");
        expect(JSON.parse(cap2.get())).toEqual({ result: { ok: 2 } });
      } finally {
        cap2.restore();
      }
    } finally {
      cap.restore();
    }
  });
});
