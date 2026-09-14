import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createStyle } from "@inspector/cli/style.js";
import type { ElicitationRequestFrame } from "../src/daemon/protocol.js";

const question = vi.fn();
const close = vi.fn();

vi.mock("node:readline/promises", () => ({
  createInterface: () => ({ question, close }),
}));

/**
 * Covers `promptElicitation`'s terminal UI: form mode always declines
 * (rendering isn't built yet), non-interactive callers auto-cancel with a
 * clear message instead of hanging, and interactive URL mode reads the
 * user's accept/cancel choice.
 */
describe("promptElicitation", () => {
  let stderr: string;
  let originalWrite: typeof process.stderr.write;

  beforeEach(() => {
    stderr = "";
    originalWrite = process.stderr.write;
    process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
      stderr += typeof chunk === "string" ? chunk : String(chunk);
      const cb = rest.find((r) => typeof r === "function") as
        | (() => void)
        | undefined;
      cb?.();
      return true;
    }) as typeof process.stderr.write;
    question.mockReset();
    close.mockReset();
  });

  afterEach(() => {
    process.stderr.write = originalWrite;
  });

  const style = createStyle(false);

  function urlFrame(
    overrides: Partial<ElicitationRequestFrame> = {},
  ): ElicitationRequestFrame {
    return {
      id: "req-1",
      kind: "elicitation-request",
      elicitationId: "elicitation-1",
      mode: "url",
      message: "Please confirm",
      url: "https://example.com/confirm",
      origin: "server-request",
      ...overrides,
    };
  }

  it("declines form-mode elicitations without prompting (not yet rendered)", async () => {
    const { promptElicitation } = await import(
      "../src/session/elicitation-prompt.js"
    );
    const frame = urlFrame({ mode: "form", url: undefined });
    const answer = await promptElicitation(frame, { interactive: true, style });
    expect(answer).toEqual({
      id: "req-1",
      kind: "elicitation-response",
      elicitationId: "elicitation-1",
      action: "decline",
    });
    expect(question).not.toHaveBeenCalled();
    expect(stderr).toContain("doesn't support");
  });

  it("cancels non-interactively (e.g. --format json or non-TTY) without prompting", async () => {
    const { promptElicitation } = await import(
      "../src/session/elicitation-prompt.js"
    );
    const frame = urlFrame();
    const answer = await promptElicitation(frame, {
      interactive: false,
      style,
    });
    expect(answer).toEqual({
      id: "req-1",
      kind: "elicitation-response",
      elicitationId: "elicitation-1",
      action: "cancel",
    });
    expect(question).not.toHaveBeenCalled();
    expect(stderr).toContain("requires an interactive terminal");
  });

  it("cancels non-interactively without a url line when the frame has none", async () => {
    const { promptElicitation } = await import(
      "../src/session/elicitation-prompt.js"
    );
    const frame = urlFrame({ url: undefined });
    const answer = await promptElicitation(frame, {
      interactive: false,
      style,
    });
    expect(answer.action).toBe("cancel");
    expect(stderr).not.toContain("undefined");
  });

  it("accepts when the interactive user confirms completion", async () => {
    question.mockResolvedValue("");
    const { promptElicitation } = await import(
      "../src/session/elicitation-prompt.js"
    );
    const frame = urlFrame();
    const answer = await promptElicitation(frame, { interactive: true, style });
    expect(answer).toEqual({
      id: "req-1",
      kind: "elicitation-response",
      elicitationId: "elicitation-1",
      action: "accept",
    });
    expect(close).toHaveBeenCalled();
    expect(stderr).toContain("Please confirm");
    expect(stderr).toContain("https://example.com/confirm");
  });

  it("cancels when the interactive user types 'c'", async () => {
    question.mockResolvedValue("c");
    const { promptElicitation } = await import(
      "../src/session/elicitation-prompt.js"
    );
    const frame = urlFrame();
    const answer = await promptElicitation(frame, { interactive: true, style });
    expect(answer.action).toBe("cancel");
  });

  it("falls back to cancel if reading input throws", async () => {
    question.mockRejectedValue(new Error("stdin closed"));
    const { promptElicitation } = await import(
      "../src/session/elicitation-prompt.js"
    );
    const frame = urlFrame();
    const answer = await promptElicitation(frame, { interactive: true, style });
    expect(answer.action).toBe("cancel");
    expect(close).toHaveBeenCalled();
  });
});
