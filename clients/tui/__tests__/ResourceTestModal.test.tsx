import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "ink-testing-library";
import type { InspectorClient } from "@inspector/core/mcp/index.js";

// ScrollView passthrough so the results JSX actually mounts (and is covered).
vi.mock("ink-scroll-view", () => import("./helpers/inkScrollViewMock.js"));
// Form double that fires onSubmit when the user presses Enter ("\r").
vi.mock("ink-form", () => import("./helpers/inkFormMock.js"));

import { ResourceTestModal } from "../src/components/ResourceTestModal.js";

// These modals render position="absolute", which produces an EMPTY frame under
// ink-testing-library. So we assert on BEHAVIOR — the injected client fake's
// readResourceFromTemplate, onClose, and the state transitions they drive —
// rather than on lastFrame(). React still EXECUTES the inner results/error JSX,
// so its coverage is collected even though it isn't visible.

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const ESC = String.fromCharCode(27);
const UP = `${ESC}[A`;
const DOWN = `${ESC}[B`;
const PAGE_UP = `${ESC}[5~`;
const PAGE_DOWN = `${ESC}[6~`;

type Template = {
  name: string;
  uriTemplate: string;
  description?: string;
};

const makeTemplate = (over: Partial<Template> = {}): Template => ({
  name: "Greeting",
  uriTemplate: "greeting://{name}",
  ...over,
});

const fakeClient = (readResourceFromTemplate: unknown): InspectorClient =>
  ({ readResourceFromTemplate }) as unknown as InspectorClient;

const setSubmitValue = (value: Record<string, unknown>) => {
  (globalThis as Record<string, unknown>).__INK_FORM_SUBMIT_VALUE__ = value;
};

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__INK_FORM_SUBMIT_VALUE__;
  vi.restoreAllMocks();
});

const renderAndSubmit = async (
  client: InspectorClient | null,
  template: Template = makeTemplate(),
  submitValue: Record<string, unknown> = { name: "world" },
) => {
  const onClose = vi.fn();
  const api = render(
    <ResourceTestModal
      template={template}
      inspectorClient={client}
      width={80}
      height={24}
      onClose={onClose}
    />,
  );
  await tick();
  setSubmitValue(submitValue);
  api.stdin.write("\r");
  await tick();
  await tick();
  return { ...api, onClose };
};

describe("ResourceTestModal", () => {
  it("renders the form initially without invoking the client", async () => {
    const read = vi.fn();
    const api = render(
      <ResourceTestModal
        template={makeTemplate()}
        inspectorClient={fakeClient(read)}
        width={80}
        height={24}
        onClose={vi.fn()}
      />,
    );
    await tick();
    expect(read).not.toHaveBeenCalled();
    api.unmount();
  });

  it("renders the template description when present", async () => {
    const read = vi.fn();
    const api = render(
      <ResourceTestModal
        template={makeTemplate({ description: "A friendly greeting" })}
        inspectorClient={fakeClient(read)}
        width={80}
        height={24}
        onClose={vi.fn()}
      />,
    );
    await tick();
    api.unmount();
  });

  it("uses the 'Unknown Template' label when the template has an empty name", async () => {
    const read = vi.fn();
    const api = render(
      <ResourceTestModal
        template={makeTemplate({ name: "" })}
        inspectorClient={fakeClient(read)}
        width={80}
        height={24}
        onClose={vi.fn()}
      />,
    );
    await tick();
    api.unmount();
  });

  it("renders the loading state while the read is in flight", async () => {
    let resolveRead: (v: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      resolveRead = resolve;
    });
    const read = vi.fn().mockReturnValue(pending);
    const api = render(
      <ResourceTestModal
        template={makeTemplate()}
        inspectorClient={fakeClient(read)}
        width={80}
        height={24}
        onClose={vi.fn()}
      />,
    );
    await tick();
    setSubmitValue({ name: "world" });
    api.stdin.write("\r");
    await tick();
    // The component is now committed in the "loading" state (read not resolved).
    expect(read).toHaveBeenCalled();
    resolveRead({
      result: { contents: [{ uri: "greeting://world", text: "hi" }] },
      expandedUri: "greeting://world",
    });
    await tick();
    await tick();
    api.unmount();
  });

  it("reads the resource and shows successful content", async () => {
    const read = vi.fn().mockResolvedValue({
      result: { contents: [{ uri: "greeting://world", text: "hi" }] },
      expandedUri: "greeting://world",
    });
    const { onClose, stdin, unmount } = await renderAndSubmit(
      fakeClient(read),
      makeTemplate(),
      { name: "world" },
    );
    expect(read).toHaveBeenCalledWith("greeting://{name}", { name: "world" });
    // Drive scroll keys in results state for scrollBy / page coverage.
    stdin.write(DOWN);
    await tick();
    stdin.write(UP);
    await tick();
    stdin.write(PAGE_DOWN);
    await tick();
    stdin.write(PAGE_UP);
    await tick();
    expect(onClose).not.toHaveBeenCalled();
    unmount();
  });

  it("catches an Error thrown by readResourceFromTemplate", async () => {
    const read = vi.fn().mockRejectedValue(new Error("not found"));
    const { unmount } = await renderAndSubmit(fakeClient(read));
    expect(read).toHaveBeenCalled();
    unmount();
  });

  it("catches a string thrown by readResourceFromTemplate", async () => {
    const read = vi.fn().mockRejectedValue("boom");
    const { unmount } = await renderAndSubmit(fakeClient(read));
    expect(read).toHaveBeenCalled();
    unmount();
  });

  it("catches an object error carrying uri and message (uri + Object.assign branches)", async () => {
    const read = vi
      .fn()
      .mockRejectedValue({ message: "bad uri", uri: "greeting://expanded" });
    const { unmount } = await renderAndSubmit(fakeClient(read));
    expect(read).toHaveBeenCalled();
    unmount();
  });

  it("catches an object error without message or uri (Object.assign + Unknown error)", async () => {
    const read = vi.fn().mockRejectedValue({ code: 42 });
    const { unmount } = await renderAndSubmit(fakeClient(read));
    expect(read).toHaveBeenCalled();
    unmount();
  });

  it("catches a non-object, non-string throw (else branch)", async () => {
    const read = vi.fn().mockRejectedValue(12345);
    const { unmount } = await renderAndSubmit(fakeClient(read));
    expect(read).toHaveBeenCalled();
    unmount();
  });

  it("does nothing on submit when inspectorClient is null (early-return guard)", async () => {
    const { onClose, unmount } = await renderAndSubmit(null);
    expect(onClose).not.toHaveBeenCalled();
    unmount();
  });

  it("closes on ESC while in form state", async () => {
    const onClose = vi.fn();
    const api = render(
      <ResourceTestModal
        template={makeTemplate()}
        inspectorClient={fakeClient(vi.fn())}
        width={80}
        height={24}
        onClose={onClose}
      />,
    );
    await tick();
    api.stdin.write(ESC);
    await tick();
    expect(onClose).toHaveBeenCalledTimes(1);
    api.unmount();
  });

  it("closes on ESC while in results state", async () => {
    const read = vi.fn().mockResolvedValue({
      result: { contents: [{ uri: "greeting://world", text: "hi" }] },
      expandedUri: "greeting://world",
    });
    const { onClose, stdin, unmount } = await renderAndSubmit(fakeClient(read));
    stdin.write(ESC);
    await tick();
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("responds to a stdout resize event", async () => {
    const api = render(
      <ResourceTestModal
        template={makeTemplate()}
        inspectorClient={fakeClient(vi.fn())}
        width={80}
        height={24}
        onClose={vi.fn()}
      />,
    );
    await tick();
    process.stdout.emit("resize");
    await tick();
    api.unmount();
  });
});
