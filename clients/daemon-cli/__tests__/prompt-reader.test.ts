import { describe, it, expect, afterEach } from "vitest";
import { PassThrough } from "node:stream";
import {
  PromptReader,
  getSharedPromptReader,
  resetSharedPromptReader,
} from "../src/connection/prompt-reader.js";

/**
 * Covers the persistent line-queue reader that backs interactive prompts:
 * piped input buffered ahead of the questions (the `printf 'a\nb\n' |
 * mcpdo tools/call …` case) must answer every question, and "close" must
 * mean input *exhausted* (EOF and empty queue), not merely EOF.
 */
describe("PromptReader", () => {
  let reader: PromptReader | undefined;

  afterEach(() => {
    reader?.dispose();
    reader = undefined;
    resetSharedPromptReader();
  });

  function make(): {
    reader: PromptReader;
    input: PassThrough;
    output: () => string;
  } {
    const input = new PassThrough();
    const out = new PassThrough();
    let written = "";
    out.on("data", (chunk) => {
      written += String(chunk);
    });
    reader = new PromptReader(
      input as unknown as NodeJS.ReadStream,
      out as unknown as NodeJS.WriteStream,
    );
    return { reader, input, output: () => written };
  }

  it("answers sequential questions from one up-front piped burst", async () => {
    const { reader, input, output } = make();
    // All three answers arrive before any question is asked — the exact
    // shape of `printf 'alice\n30\n\n' | mcpdo tools/call register`.
    input.write("alice\n30\n\n");
    await expect(reader.question("Name: ")).resolves.toBe("alice");
    await expect(reader.question("Age: ")).resolves.toBe("30");
    await expect(reader.question("Color: ")).resolves.toBe("");
    expect(output()).toBe("Name: Age: Color: ");
  });

  it("resolves a pending question when its line arrives later", async () => {
    const { reader, input } = make();
    const pending = reader.question("Name: ");
    input.write("octocat\n");
    await expect(pending).resolves.toBe("octocat");
  });

  it("still answers from the queue after EOF, then reports exhaustion", async () => {
    const { reader, input } = make();
    let closed = 0;
    reader.once("close", () => {
      closed += 1;
    });
    input.end("alice\n");
    // Give readline a beat to flush the final chunk and see EOF.
    await expect(reader.question("Name: ")).resolves.toBe("alice");
    // EOF alone must not have fired "close" while an answer was queued.
    expect(closed).toBe(0);
    await expect(reader.question("Age: ")).rejects.toThrow(/stdin closed/);
    expect(closed).toBe(1);
    // A listener registered after exhaustion fires immediately.
    reader.once("close", () => {
      closed += 1;
    });
    expect(closed).toBe(2);
    // And later questions keep rejecting without hanging.
    await expect(reader.question("More: ")).rejects.toThrow(/stdin closed/);
  });

  it("rejects a question pending at EOF and notifies close watchers", async () => {
    const { reader, input } = make();
    let closed = false;
    reader.once("close", () => {
      closed = true;
    });
    const pending = reader.question("Name: ");
    input.end();
    await expect(pending).rejects.toThrow(/stdin closed/);
    expect(closed).toBe(true);
  });

  it("shares one process-wide reader, and reset disposes it", () => {
    const first = getSharedPromptReader();
    expect(getSharedPromptReader()).toBe(first);
    resetSharedPromptReader();
    const second = getSharedPromptReader();
    expect(second).not.toBe(first);
  });
});
