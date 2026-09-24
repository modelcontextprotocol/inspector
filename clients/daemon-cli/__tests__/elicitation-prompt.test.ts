import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createStyle } from "@inspector/cli/style.js";
import type { ElicitationRequestFrame } from "../src/daemon/protocol.js";

const question = vi.fn();
const close = vi.fn();
const promptFormMock = vi.fn();

const once = vi.fn();

vi.mock("node:readline/promises", () => ({
  createInterface: () => ({ question, close, once }),
}));

vi.mock("../src/connection/form-prompt.js", async () => {
  const actual = await vi.importActual<
    typeof import("../src/connection/form-prompt.js")
  >("../src/connection/form-prompt.js");
  return {
    promptForm: (...args: unknown[]) => promptFormMock(...args),
    watchForClose: actual.watchForClose,
  };
});

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
    once.mockReset();
    promptFormMock.mockReset();
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

  function formFrame(
    overrides: Partial<ElicitationRequestFrame> = {},
  ): ElicitationRequestFrame {
    return {
      id: "req-1",
      kind: "elicitation-request",
      elicitationId: "elicitation-1",
      mode: "form",
      message: "Please provide your name",
      requestedSchema: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
      origin: "server-request",
      ...overrides,
    };
  }

  it("declines form-mode elicitations whose schema isn't the restricted primitive shape", async () => {
    const { promptElicitation } =
      await import("../src/connection/elicitation-prompt.js");
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

  it("declines form-mode elicitations non-interactively without prompting", async () => {
    const { promptElicitation } =
      await import("../src/connection/elicitation-prompt.js");
    const frame = urlFrame({
      mode: "form",
      url: undefined,
      requestedSchema: {
        type: "object",
        properties: { name: { type: "string" } },
      },
    });
    const answer = await promptElicitation(frame, {
      interactive: false,
      style,
    });
    expect(answer).toEqual({
      id: "req-1",
      kind: "elicitation-response",
      elicitationId: "elicitation-1",
      action: "decline",
    });
    expect(question).not.toHaveBeenCalled();
    expect(stderr).toContain("--format json");
  });

  it("cancels when the caller isn't interactive (e.g. --format json) without prompting", async () => {
    const { promptElicitation } =
      await import("../src/connection/elicitation-prompt.js");
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
    expect(stderr).toContain("--format json");
  });

  it("cancels non-interactively without a url line when the frame has none", async () => {
    const { promptElicitation } =
      await import("../src/connection/elicitation-prompt.js");
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
    const { promptElicitation } =
      await import("../src/connection/elicitation-prompt.js");
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

  it("renders only allowlisted schemes as OSC 8 links in URL mode", async () => {
    question.mockResolvedValue("");
    const ansi = createStyle(true);
    const { promptElicitation } =
      await import("../src/connection/elicitation-prompt.js");

    await promptElicitation(urlFrame(), { interactive: true, style: ansi });
    expect(stderr).toContain("\u001b]8;;https://example.com/confirm");

    stderr = "";
    const answer = await promptElicitation(
      urlFrame({ url: "file:///etc/passwd" }),
      { interactive: true, style: ansi },
    );
    // A server-supplied file:/custom-handler URL is shown as plain text —
    // never as a clickable link inviting the local protocol handler.
    expect(answer.action).toBe("accept");
    expect(stderr).not.toContain("]8;;");
    expect(stderr).toContain("file:///etc/passwd");
  });

  it("cancels when the interactive user types 'c'", async () => {
    question.mockResolvedValue("c");
    const { promptElicitation } =
      await import("../src/connection/elicitation-prompt.js");
    const frame = urlFrame();
    const answer = await promptElicitation(frame, { interactive: true, style });
    expect(answer.action).toBe("cancel");
  });

  it("falls back to cancel if reading input throws", async () => {
    question.mockRejectedValue(new Error("stdin closed"));
    const { promptElicitation } =
      await import("../src/connection/elicitation-prompt.js");
    const frame = urlFrame();
    const answer = await promptElicitation(frame, { interactive: true, style });
    expect(answer.action).toBe("cancel");
    expect(close).toHaveBeenCalled();
  });

  it("cancels URL mode if stdin closes before the user answers", async () => {
    // Simulates a non-TTY stdin (e.g. an agent-driven pipe) hitting EOF
    // before an answer arrives: question() hangs, but the "close" listener
    // registered via watchForClose() fires and wins the race.
    question.mockImplementation(() => new Promise(() => {}));
    once.mockImplementation((event: string, cb: () => void) => {
      if (event === "close") cb();
    });
    const { promptElicitation } =
      await import("../src/connection/elicitation-prompt.js");
    const frame = urlFrame();
    const answer = await promptElicitation(frame, { interactive: true, style });
    expect(answer.action).toBe("cancel");
    expect(close).toHaveBeenCalled();
  });

  it("accepts an interactive form submission and returns its content", async () => {
    promptFormMock.mockResolvedValue({
      action: "accept",
      content: { name: "octocat" },
    });
    const { promptElicitation } =
      await import("../src/connection/elicitation-prompt.js");
    const frame = formFrame();
    const answer = await promptElicitation(frame, { interactive: true, style });
    expect(answer).toEqual({
      id: "req-1",
      kind: "elicitation-response",
      elicitationId: "elicitation-1",
      action: "accept",
      content: { name: "octocat" },
    });
    expect(close).toHaveBeenCalled();
  });

  it("declines an interactive form when promptForm reports decline", async () => {
    promptFormMock.mockResolvedValue({ action: "decline" });
    const { promptElicitation } =
      await import("../src/connection/elicitation-prompt.js");
    const frame = formFrame();
    const answer = await promptElicitation(frame, { interactive: true, style });
    expect(answer.action).toBe("decline");
  });

  it("cancels an interactive form when promptForm reports cancel", async () => {
    promptFormMock.mockResolvedValue({ action: "cancel" });
    const { promptElicitation } =
      await import("../src/connection/elicitation-prompt.js");
    const frame = formFrame();
    const answer = await promptElicitation(frame, { interactive: true, style });
    expect(answer.action).toBe("cancel");
  });

  it("falls back to cancel if promptForm throws", async () => {
    promptFormMock.mockRejectedValue(new Error("stdin closed"));
    const { promptElicitation } =
      await import("../src/connection/elicitation-prompt.js");
    const frame = formFrame();
    const answer = await promptElicitation(frame, { interactive: true, style });
    expect(answer.action).toBe("cancel");
    expect(close).toHaveBeenCalled();
  });
});
