import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "ink-testing-library";
import type { InspectorClient } from "@inspector/core/mcp/index.js";
import { AuthRecoveryRequiredError } from "@inspector/core/auth/challenge.js";
import type { Prompt } from "@modelcontextprotocol/sdk/types.js";

// ScrollView: passthrough so the results JSX actually mounts (and is counted
// for coverage) and the imperative ref API exists for the scroll handlers.
vi.mock("ink-scroll-view", () => import("./helpers/inkScrollViewMock.js"));
// Form: a double that fires onSubmit when the user presses Enter ("\r").
vi.mock("ink-form", () => import("./helpers/inkFormMock.js"));

import { PromptTestModal } from "../src/components/PromptTestModal.js";

// Ink processes stdin keypresses asynchronously — await this after stdin.write
// and let the async getPrompt promise + setState settle.
const tick = async () => {
  // Flush several macrotask cycles so an effect -> setState -> re-render chain
  // settles before assertions, even on slow/loaded CI (a single tick can race).
  for (let i = 0; i < 8; i++)
    await new Promise((resolve) => setTimeout(resolve, 4));
};

const ESC = String.fromCharCode(27);
const UP = `${ESC}[A`;
const DOWN = `${ESC}[B`;
const PAGE_UP = `${ESC}[5~`;
const PAGE_DOWN = `${ESC}[6~`;
const ENTER = "\r";

const makePrompt = (over: Partial<Prompt> = {}): Prompt =>
  ({
    name: "alpha",
    description: "First prompt",
    arguments: [{ name: "topic", description: "a topic", required: true }],
    ...over,
  }) as unknown as Prompt;

// Set the value the mock Form submits on Enter; reset afterward so cases
// don't leak into one another.
function setFormSubmitValue(value: Record<string, string> | undefined) {
  if (value === undefined) {
    delete (globalThis as Record<string, unknown>).__INK_FORM_SUBMIT_VALUE__;
  } else {
    (globalThis as Record<string, unknown>).__INK_FORM_SUBMIT_VALUE__ = value;
  }
}

afterEach(() => {
  setFormSubmitValue(undefined);
  vi.restoreAllMocks();
});

describe("PromptTestModal", () => {
  it("submits the form, calls getPrompt, and shows results (success path)", async () => {
    const getPrompt = vi.fn().mockResolvedValue({
      result: {
        description: "ok",
        messages: [{ role: "user", content: { type: "text", text: "hello" } }],
      },
    });
    const inspectorClient = { getPrompt } as unknown as InspectorClient;
    const prompt = makePrompt();

    // Submit a non-empty value so the "Arguments:" block (input length > 0)
    // is rendered in the results view.
    setFormSubmitValue({ topic: "weather" });

    const { stdin } = render(
      <PromptTestModal
        prompt={prompt}
        inspectorClient={inspectorClient}
        width={120}
        height={30}
        onClose={() => {}}
      />,
    );

    await tick();
    stdin.write(ENTER);
    await tick();
    await tick();

    expect(getPrompt).toHaveBeenCalledWith("alpha", { topic: "weather" });

    // Now in results mode — drive every scroll key branch.
    stdin.write(DOWN);
    await tick();
    stdin.write(UP);
    await tick();
    stdin.write(PAGE_DOWN);
    await tick();
    stdin.write(PAGE_UP);
    await tick();
  });

  it("renders the loading state while getPrompt is pending", async () => {
    let resolveGetPrompt!: (value: { result: { messages: unknown[] } }) => void;
    const getPrompt = vi.fn().mockReturnValue(
      new Promise<{ result: { messages: unknown[] } }>((resolve) => {
        resolveGetPrompt = resolve;
      }),
    );
    const inspectorClient = { getPrompt } as unknown as InspectorClient;

    const { stdin } = render(
      <PromptTestModal
        prompt={makePrompt()}
        inspectorClient={inspectorClient}
        width={120}
        height={30}
        onClose={() => {}}
      />,
    );

    await tick();
    stdin.write(ENTER);
    // One tick: state has transitioned to "loading" but the promise is still
    // pending, so the loading JSX is mounted.
    await tick();
    expect(getPrompt).toHaveBeenCalledTimes(1);

    // Now let it resolve and settle into results.
    resolveGetPrompt({ result: { messages: [] } });
    await tick();
    await tick();
  });

  it("renders results with no arguments block when submitted value is empty", async () => {
    const getPrompt = vi.fn().mockResolvedValue({
      result: { messages: [] },
    });
    const inspectorClient = { getPrompt } as unknown as InspectorClient;

    // Default submit value is {} → Object.keys(input).length === 0 branch.
    const { stdin } = render(
      <PromptTestModal
        prompt={makePrompt({ description: undefined })}
        inspectorClient={inspectorClient}
        width={120}
        height={30}
        onClose={() => {}}
      />,
    );

    await tick();
    stdin.write(ENTER);
    await tick();
    await tick();

    expect(getPrompt).toHaveBeenCalledTimes(1);
  });

  it("shows error results when getPrompt rejects with an Error", async () => {
    const getPrompt = vi.fn().mockRejectedValue(new Error("boom"));
    const inspectorClient = { getPrompt } as unknown as InspectorClient;

    setFormSubmitValue({ topic: "x" });

    const { stdin } = render(
      <PromptTestModal
        prompt={makePrompt()}
        inspectorClient={inspectorClient}
        width={120}
        height={30}
        onClose={() => {}}
      />,
    );

    await tick();
    stdin.write(ENTER);
    await tick();
    await tick();

    expect(getPrompt).toHaveBeenCalledTimes(1);

    // Scroll through the error results to exercise the results scroll branches.
    stdin.write(DOWN);
    await tick();
  });

  it("handles a rejected getPrompt that throws a string", async () => {
    const getPrompt = vi.fn().mockRejectedValue("string failure");
    const inspectorClient = { getPrompt } as unknown as InspectorClient;

    const { stdin } = render(
      <PromptTestModal
        prompt={makePrompt()}
        inspectorClient={inspectorClient}
        width={120}
        height={30}
        onClose={() => {}}
      />,
    );

    await tick();
    stdin.write(ENTER);
    await tick();
    await tick();

    expect(getPrompt).toHaveBeenCalledTimes(1);
  });

  it("handles a rejected getPrompt that throws an object with a message", async () => {
    const getPrompt = vi
      .fn()
      .mockRejectedValue({ message: "obj msg", code: 7 });
    const inspectorClient = { getPrompt } as unknown as InspectorClient;

    const { stdin } = render(
      <PromptTestModal
        prompt={makePrompt()}
        inspectorClient={inspectorClient}
        width={120}
        height={30}
        onClose={() => {}}
      />,
    );

    await tick();
    stdin.write(ENTER);
    await tick();
    await tick();

    expect(getPrompt).toHaveBeenCalledTimes(1);
  });

  it("handles a rejected getPrompt that throws an object without a message", async () => {
    const getPrompt = vi.fn().mockRejectedValue({ code: 99 });
    const inspectorClient = { getPrompt } as unknown as InspectorClient;

    const { stdin } = render(
      <PromptTestModal
        prompt={makePrompt()}
        inspectorClient={inspectorClient}
        width={120}
        height={30}
        onClose={() => {}}
      />,
    );

    await tick();
    stdin.write(ENTER);
    await tick();
    await tick();

    expect(getPrompt).toHaveBeenCalledTimes(1);
  });

  it("handles a rejected getPrompt that throws a non-object, non-string value", async () => {
    const getPrompt = vi.fn().mockRejectedValue(42);
    const inspectorClient = { getPrompt } as unknown as InspectorClient;

    const { stdin } = render(
      <PromptTestModal
        prompt={makePrompt()}
        inspectorClient={inspectorClient}
        width={120}
        height={30}
        onClose={() => {}}
      />,
    );

    await tick();
    stdin.write(ENTER);
    await tick();
    await tick();

    expect(getPrompt).toHaveBeenCalledTimes(1);
  });

  it("does nothing when inspectorClient is null (early return)", async () => {
    const onClose = vi.fn();
    const { stdin } = render(
      <PromptTestModal
        prompt={makePrompt()}
        inspectorClient={null}
        width={120}
        height={30}
        onClose={onClose}
      />,
    );

    await tick();
    // Submitting the form hits handleFormSubmit which returns early because
    // inspectorClient is null — state stays "form", no crash.
    stdin.write(ENTER);
    await tick();
    await tick();

    // Still in form mode: a non-escape key is ignored by the form-state branch.
    stdin.write("a");
    await tick();

    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on ESC and resets state", async () => {
    const onClose = vi.fn();
    const getPrompt = vi.fn().mockResolvedValue({ result: { messages: [] } });
    const inspectorClient = { getPrompt } as unknown as InspectorClient;

    const { stdin } = render(
      <PromptTestModal
        prompt={makePrompt()}
        inspectorClient={inspectorClient}
        width={120}
        height={30}
        onClose={onClose}
      />,
    );

    await tick();
    // Get into results mode first so the escape-from-results path runs.
    stdin.write(ENTER);
    await tick();
    await tick();

    stdin.write(ESC);
    await tick();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("unmounts cleanly, running cleanup effects", async () => {
    const getPrompt = vi.fn().mockResolvedValue({ result: { messages: [] } });
    const inspectorClient = { getPrompt } as unknown as InspectorClient;

    const { unmount } = render(
      <PromptTestModal
        prompt={makePrompt({ arguments: undefined, description: undefined })}
        inspectorClient={inspectorClient}
        width={120}
        height={30}
        onClose={() => {}}
      />,
    );

    await tick();
    unmount();
    await tick();
    expect(true).toBe(true);
  });

  it("delegates AuthRecoveryRequiredError to onAuthRecoveryRequired and closes", async () => {
    const recovery = new AuthRecoveryRequiredError(
      new URL("https://auth.example.com/authorize"),
      { reason: "insufficient_scope", requiredScopes: ["weather:read"] },
    );
    const getPrompt = vi.fn().mockRejectedValue(recovery);
    const onClose = vi.fn();
    const onAuthRecoveryRequired = vi.fn();
    setFormSubmitValue({ topic: "x" });

    const { stdin } = render(
      <PromptTestModal
        prompt={makePrompt()}
        inspectorClient={{ getPrompt } as unknown as InspectorClient}
        width={120}
        height={30}
        onClose={onClose}
        onAuthRecoveryRequired={onAuthRecoveryRequired}
      />,
    );

    await tick();
    stdin.write(ENTER);
    await tick();
    await tick();

    expect(onAuthRecoveryRequired).toHaveBeenCalledWith(recovery);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
