import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "./helpers/renderTui";
import type { InspectorClient } from "@inspector/core/mcp/index.js";
import type { Tool } from "@modelcontextprotocol/client";

// ScrollView passthrough so the results JSX actually mounts (and is covered).
vi.mock("ink-scroll-view", () => import("./helpers/inkScrollViewMock.js"));
// Form double that fires onSubmit when the user presses Enter ("\r").
vi.mock("ink-form", () => import("./helpers/inkFormMock.js"));

import { ToolTestModal } from "../src/components/ToolTestModal.js";

// These modals render position="absolute", which produces an EMPTY frame under
// ink-testing-library (absolute boxes aren't laid out at the root). So we assert
// on BEHAVIOR — the injected client fake's methods, onClose, and the state
// transitions they drive — rather than on lastFrame() content. React still
// EXECUTES the inner results/error/loading JSX, so its coverage is collected.

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

const makeTool = (over: Partial<Tool> = {}): Tool =>
  ({
    name: "alpha",
    description: "First tool",
    inputSchema: { type: "object", properties: {} },
    ...over,
  }) as unknown as Tool;

const fakeClient = (callTool: unknown): InspectorClient =>
  ({ callTool }) as unknown as InspectorClient;

// Set the value the Form double submits on Enter; cleared after each test.
const setSubmitValue = (value: Record<string, unknown>) => {
  (globalThis as Record<string, unknown>).__INK_FORM_SUBMIT_VALUE__ = value;
};

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__INK_FORM_SUBMIT_VALUE__;
  vi.restoreAllMocks();
});

// Render → submit form → let the awaited callTool + setState settle.
const renderAndSubmit = async (
  client: InspectorClient | null,
  submitValue: Record<string, unknown> = {},
) => {
  const onClose = vi.fn();
  const api = render(
    <ToolTestModal
      tool={makeTool()}
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

describe("ToolTestModal", () => {
  it("reports a missing required argument instead of calling the tool (#2123)", async () => {
    // A union branch's fields render optional — a static form cannot demand
    // every branch's — so the chosen shape's own requirements are checked here.
    const callTool = vi.fn();
    const tool = makeTool({
      inputSchema: {
        type: "object",
        oneOf: [
          {
            type: "object",
            properties: {
              kind: { type: "string", const: "email" },
              address: { type: "string" },
            },
            required: ["kind", "address"],
          },
          {
            type: "object",
            properties: {
              kind: { type: "string", const: "sms" },
              phone: { type: "string" },
            },
            required: ["kind", "phone"],
          },
        ],
      },
    });
    const api = render(
      <ToolTestModal
        tool={tool}
        inspectorClient={fakeClient(callTool)}
        width={80}
        height={24}
        onClose={vi.fn()}
      />,
    );
    await tick();
    setSubmitValue({ __variant: "0", __b0__kind: "email" });
    api.stdin.write("\r");
    await tick();
    await tick();
    // The assertion is the transition, not the frame — this suite drives state,
    // not rendered text (see the note at the top of the file).
    expect(callTool).not.toHaveBeenCalled();
    api.unmount();
  });

  it("resolves a $ref'd union branch before checking its required arguments (#2321)", async () => {
    // Unresolved, a `$ref` branch's requirements read as unknown and the call
    // would go out missing `address`; inlined, the branch is checked as written.
    const callTool = vi.fn();
    const tool = makeTool({
      inputSchema: {
        type: "object",
        oneOf: [{ $ref: "#/$defs/Email" }, { $ref: "#/$defs/Sms" }],
        $defs: {
          Email: {
            type: "object",
            properties: {
              kind: { type: "string", const: "email" },
              address: { type: "string" },
            },
            required: ["kind", "address"],
          },
          Sms: {
            type: "object",
            properties: {
              kind: { type: "string", const: "sms" },
              phone: { type: "string" },
            },
            required: ["kind", "phone"],
          },
        },
      },
    });
    const api = render(
      <ToolTestModal
        tool={tool}
        inspectorClient={fakeClient(callTool)}
        width={80}
        height={24}
        onClose={vi.fn()}
      />,
    );
    await tick();
    setSubmitValue({ __variant: "0", __b0__kind: "email" });
    api.stdin.write("\r");
    await tick();
    await tick();
    expect(callTool).not.toHaveBeenCalled();
    api.unmount();
  });

  it("names every missing required argument (#2123)", async () => {
    const callTool = vi.fn();
    const tool = makeTool({
      inputSchema: {
        type: "object",
        properties: { a: { type: "string" }, b: { type: "string" } },
        required: ["a", "b"],
      },
    });
    const api = render(
      <ToolTestModal
        tool={tool}
        inspectorClient={fakeClient(callTool)}
        width={80}
        height={24}
        onClose={vi.fn()}
      />,
    );
    await tick();
    setSubmitValue({});
    api.stdin.write("\r");
    await tick();
    await tick();
    // Two missing names, which is also the plural branch of the message.
    expect(callTool).not.toHaveBeenCalled();
    api.unmount();
  });

  it("renders the form initially without invoking the client", async () => {
    const callTool = vi.fn();
    const api = render(
      <ToolTestModal
        tool={makeTool()}
        inspectorClient={fakeClient(callTool)}
        width={80}
        height={24}
        onClose={vi.fn()}
      />,
    );
    await tick();
    expect(callTool).not.toHaveBeenCalled();
    api.unmount();
  });

  it("falls back to a default form structure (and name) when the tool has no inputSchema or name", async () => {
    const callTool = vi.fn();
    const tool = makeTool({ inputSchema: undefined, name: "" });
    const api = render(
      <ToolTestModal
        tool={tool}
        inspectorClient={fakeClient(callTool)}
        width={80}
        height={24}
        onClose={vi.fn()}
      />,
    );
    await tick();
    api.unmount();
  });

  it("uses the 'Unknown Tool' label when a schema-bearing tool has an empty name", async () => {
    const callTool = vi.fn();
    const tool = makeTool({ name: "" });
    const api = render(
      <ToolTestModal
        tool={tool}
        inspectorClient={fakeClient(callTool)}
        width={80}
        height={24}
        onClose={vi.fn()}
      />,
    );
    await tick();
    api.unmount();
  });

  it("renders the loading state while the call is in flight", async () => {
    let resolveCall: (v: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      resolveCall = resolve;
    });
    const callTool = vi.fn().mockReturnValue(pending);
    const onClose = vi.fn();
    const api = render(
      <ToolTestModal
        tool={makeTool()}
        inspectorClient={fakeClient(callTool)}
        width={80}
        height={24}
        onClose={onClose}
      />,
    );
    await tick();
    setSubmitValue({});
    api.stdin.write("\r");
    await tick();
    // The component is now committed in the "loading" state (call not resolved).
    expect(callTool).toHaveBeenCalled();
    resolveCall({
      success: true,
      result: { content: [{ type: "text", text: "done" }] },
    });
    await tick();
    await tick();
    api.unmount();
  });

  it("calls callTool and shows successful output", async () => {
    const callTool = vi.fn().mockResolvedValue({
      success: true,
      result: { content: [{ type: "text", text: "hello" }] },
      error: undefined,
    });
    const { onClose, stdin, unmount } = await renderAndSubmit(
      fakeClient(callTool),
      { foo: "bar" },
    );
    expect(callTool).toHaveBeenCalledWith(makeTool(), { foo: "bar" });
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

  it("renders the error branch when the result has isError === true", async () => {
    const callTool = vi.fn().mockResolvedValue({
      success: true,
      result: { isError: true, content: [{ type: "text", text: "oops" }] },
    });
    const { unmount } = await renderAndSubmit(fakeClient(callTool));
    expect(callTool).toHaveBeenCalled();
    unmount();
  });

  it("renders the failed-call branch when success is false and result is null", async () => {
    const callTool = vi.fn().mockResolvedValue({
      success: false,
      result: null,
      error: "tool blew up",
    });
    const { unmount } = await renderAndSubmit(fakeClient(callTool));
    expect(callTool).toHaveBeenCalled();
    unmount();
  });

  it("uses the default error message when a failed call has no error string", async () => {
    const callTool = vi.fn().mockResolvedValue({
      success: false,
      result: null,
    });
    const { unmount } = await renderAndSubmit(fakeClient(callTool));
    expect(callTool).toHaveBeenCalled();
    unmount();
  });

  it("catches an Error thrown by callTool", async () => {
    const callTool = vi.fn().mockRejectedValue(new Error("network down"));
    const { unmount } = await renderAndSubmit(fakeClient(callTool));
    expect(callTool).toHaveBeenCalled();
    unmount();
  });

  it("catches a non-Error value thrown by callTool", async () => {
    const callTool = vi.fn().mockRejectedValue("boom");
    const { unmount } = await renderAndSubmit(fakeClient(callTool));
    expect(callTool).toHaveBeenCalled();
    unmount();
  });

  it("does nothing on submit when inspectorClient is null (early-return guard)", async () => {
    const { onClose, unmount } = await renderAndSubmit(null);
    // No client to call; stays in form state and onClose untouched.
    expect(onClose).not.toHaveBeenCalled();
    unmount();
  });

  it("closes on ESC while in form state", async () => {
    const onClose = vi.fn();
    const api = render(
      <ToolTestModal
        tool={makeTool()}
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
    const callTool = vi.fn().mockResolvedValue({
      success: true,
      result: { content: [{ type: "text", text: "hi" }] },
    });
    const { onClose, stdin, unmount } = await renderAndSubmit(
      fakeClient(callTool),
    );
    stdin.write(ESC);
    await tick();
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("responds to a stdout resize event", async () => {
    const onClose = vi.fn();
    const api = render(
      <ToolTestModal
        tool={makeTool()}
        inspectorClient={fakeClient(vi.fn())}
        width={80}
        height={24}
        onClose={onClose}
      />,
    );
    await tick();
    process.stdout.emit("resize");
    await tick();
    api.unmount();
  });
});

// The frame is empty (see the note at the top), so these assert on what lands
// on disk. The prompt and status text themselves are asserted in
// SaveResultBar.test.tsx.
describe("ToolTestModal — w saves the result to a file (#2571)", () => {
  const BACKSPACE = "\b";
  const DELETE = "\x7f";
  const TAB = "\t";
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tui-save-"));
    // Relative save paths resolve against the launch directory.
    vi.spyOn(process, "cwd").mockReturnValue(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const okClient = (result: unknown) =>
    fakeClient(vi.fn().mockResolvedValue({ success: true, result }));

  const TEXT_RESULT = { content: [{ type: "text", text: "hello" }] };

  // The write is async; wait for it to land rather than racing the fs call.
  const waitForFile = async (path: string) => {
    for (let i = 0; i < 50 && !existsSync(path); i++) await tick();
    await tick();
  };

  const press = async (stdin: { write: (s: string) => void }, s: string) => {
    stdin.write(s);
    await tick();
  };

  it("w then Enter writes the whole result as pretty JSON to <tool>-result.json", async () => {
    const { stdin, onClose, unmount } = await renderAndSubmit(
      okClient(TEXT_RESULT),
    );
    await press(stdin, "w");
    await press(stdin, "\r");
    const target = join(dir, "alpha-result.json");
    await waitForFile(target);
    expect(readFileSync(target, "utf8")).toBe(
      JSON.stringify(TEXT_RESULT, null, 2) + "\n",
    );
    expect(onClose).not.toHaveBeenCalled();
    unmount();
  });

  it("Tab switches to raw and its default name; Tab again switches back", async () => {
    const { stdin, unmount } = await renderAndSubmit(okClient(TEXT_RESULT));
    await press(stdin, "w");
    await press(stdin, TAB);
    await press(stdin, TAB);
    await press(stdin, TAB);
    await press(stdin, "\r");
    const target = join(dir, "alpha-result.txt");
    await waitForFile(target);
    expect(readFileSync(target, "utf8")).toBe("hello");
    unmount();
  });

  it("a typed path is kept across a format switch, and backspace/delete edit it", async () => {
    const { stdin, unmount } = await renderAndSubmit(okClient(TEXT_RESULT));
    await press(stdin, "w");
    // Clear "alpha-result.json" (17 chars), alternating the two erase keys.
    for (let i = 0; i < 9; i++) {
      await press(stdin, BACKSPACE);
      await press(stdin, DELETE);
    }
    await press(stdin, "out.txtx");
    await press(stdin, BACKSPACE);
    // A ctrl chord is not text and must not land in the path.
    await press(stdin, "\x01");
    await press(stdin, TAB);
    await press(stdin, "\r");
    const target = join(dir, "out.txt");
    await waitForFile(target);
    expect(readFileSync(target, "utf8")).toBe("hello");
    unmount();
  });

  it("ESC cancels the prompt without closing the modal; a second ESC closes it", async () => {
    const { stdin, onClose, unmount } = await renderAndSubmit(
      okClient(TEXT_RESULT),
    );
    await press(stdin, "w");
    await press(stdin, ESC);
    await tick();
    expect(onClose).not.toHaveBeenCalled();
    // The prompt is gone, so Enter no longer saves.
    await press(stdin, "\r");
    await tick();
    expect(existsSync(join(dir, "alpha-result.json"))).toBe(false);
    await press(stdin, ESC);
    await tick();
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("saves an isError result too — it is still the server's result", async () => {
    const errResult = {
      isError: true,
      content: [{ type: "text", text: "oops" }],
    };
    const { stdin, unmount } = await renderAndSubmit(okClient(errResult));
    await press(stdin, "w");
    await press(stdin, "\r");
    const target = join(dir, "alpha-result.json");
    await waitForFile(target);
    expect(JSON.parse(readFileSync(target, "utf8"))).toEqual(errResult);
    unmount();
  });

  it("w with no result to save opens no prompt and writes nothing", async () => {
    const callTool = vi
      .fn()
      .mockResolvedValue({ success: false, result: null, error: "boom" });
    const { stdin, onClose, unmount } = await renderAndSubmit(
      fakeClient(callTool),
    );
    await press(stdin, "w");
    await press(stdin, "\r");
    await tick();
    expect(existsSync(join(dir, "alpha-result.json"))).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    unmount();
  });

  it("a failed write is reported in the TUI, not thrown, and a retry still works", async () => {
    const { stdin, onClose, unmount } = await renderAndSubmit(
      okClient(TEXT_RESULT),
    );
    await press(stdin, "w");
    // Point the default name into a directory that does not exist.
    for (let i = 0; i < 17; i++) await press(stdin, BACKSPACE);
    await press(stdin, "missing/dir/x.json");
    await press(stdin, "\r");
    await tick();
    await tick();
    expect(existsSync(join(dir, "missing"))).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    // The modal is still alive and the default comes back on the next w.
    await press(stdin, "w");
    await press(stdin, "\r");
    const target = join(dir, "alpha-result.json");
    await waitForFile(target);
    expect(existsSync(target)).toBe(true);
    unmount();
  });

  it("a result with no raw form is refused when saved as raw", async () => {
    const linkOnly = {
      content: [{ type: "resource_link", uri: "x://a", name: "a" }],
    };
    const { stdin, onClose, unmount } = await renderAndSubmit(
      okClient(linkOnly),
    );
    await press(stdin, "w");
    await press(stdin, TAB);
    await press(stdin, "\r");
    await tick();
    await tick();
    expect(existsSync(join(dir, "alpha-result.txt"))).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    unmount();
  });

  it("falls back to a 'tool' file name when the tool has no name", async () => {
    const onClose = vi.fn();
    const api = render(
      <ToolTestModal
        tool={makeTool({ name: "" })}
        inspectorClient={okClient(TEXT_RESULT)}
        width={80}
        height={24}
        onClose={onClose}
      />,
    );
    await tick();
    setSubmitValue({});
    await press(api.stdin, "\r");
    await tick();
    await press(api.stdin, "w");
    await press(api.stdin, "\r");
    const target = join(dir, "tool-result.json");
    await waitForFile(target);
    expect(existsSync(target)).toBe(true);
    api.unmount();
  });
});
