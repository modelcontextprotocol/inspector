import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "./helpers/renderTui";
import type { Root } from "@modelcontextprotocol/client";
import type { InspectorClient } from "@inspector/core/mcp/index.js";

vi.mock("ink-form", () => import("./helpers/inkFormMock.js"));

import { RootsModal, rootFromForm } from "../src/components/RootsModal.js";

// The modal renders position="absolute", which ink-testing-library draws as an
// EMPTY frame (see ResourceTestModal.test.tsx), so these tests assert on the
// client fake and the callbacks rather than on lastFrame().

const tick = async () => {
  for (let i = 0; i < 8; i++)
    await new Promise((resolve) => setTimeout(resolve, 4));
};
const ESC = String.fromCharCode(27);
const UP = `${ESC}[A`;
const DOWN = `${ESC}[B`;
const DELETE = `${ESC}[3~`;

const setSubmitValue = (value: Record<string, unknown>) => {
  (globalThis as Record<string, unknown>).__INK_FORM_SUBMIT_VALUE__ = value;
};

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__INK_FORM_SUBMIT_VALUE__;
});

// A deliberately partial fake: RootsModal calls only `setRoots` on the client,
// and InspectorClient is a class with private members that no structural object
// literal can satisfy, so a single `as` is refused. The double cast is confined
// to this factory, and the intersection keeps `setRoots` typed as the spy.
const fakeClient = (
  setRoots: ReturnType<typeof vi.fn> = vi.fn(async () => {}),
) =>
  ({ setRoots }) as unknown as InspectorClient & { setRoots: typeof setRoots };

const roots: Root[] = [{ uri: "file:///a", name: "a" }, { uri: "file:///b" }];

function renderModal(props: Partial<React.ComponentProps<typeof RootsModal>>) {
  const onClose = vi.fn();
  const client = fakeClient();
  const api = render(
    <RootsModal
      roots={roots}
      inspectorClient={client}
      connected
      width={80}
      height={24}
      onClose={onClose}
      {...props}
    />,
  );
  return { ...api, onClose, client };
}

describe("rootFromForm", () => {
  it("trims, requires a URI and drops an empty name", () => {
    expect(rootFromForm({ uri: "  file:///x ", name: " x " })).toEqual({
      uri: "file:///x",
      name: "x",
    });
    expect(rootFromForm({ uri: "file:///x", name: "  " })).toEqual({
      uri: "file:///x",
    });
    expect(rootFromForm({ uri: "file:///x" })).toEqual({ uri: "file:///x" });
    expect(rootFromForm({ uri: " " })).toEqual({ error: "A root needs a URI" });
    expect(rootFromForm({})).toEqual({ error: "A root needs a URI" });
  });
});

describe("RootsModal", () => {
  it("removes the selected root with 'x' after moving the selection", async () => {
    const { stdin, client } = renderModal({});
    await tick();
    stdin.write(DOWN);
    await tick();
    stdin.write(DOWN); // at the end
    await tick();
    stdin.write(UP);
    await tick();
    stdin.write(UP); // at the top
    await tick();
    stdin.write(DOWN);
    await tick();
    stdin.write("x");
    await tick();
    expect(client.setRoots).toHaveBeenCalledWith([
      { uri: "file:///a", name: "a" },
    ]);
  });

  it("removes with the Delete key too", async () => {
    const { stdin, client } = renderModal({});
    await tick();
    stdin.write(DELETE);
    await tick();
    expect(client.setRoots).toHaveBeenCalledWith([{ uri: "file:///b" }]);
  });

  it("adds a root through the form", async () => {
    const { stdin, client } = renderModal({});
    await tick();
    stdin.write("n");
    await tick();
    setSubmitValue({ uri: "file:///c", name: "c" });
    stdin.write("\r");
    await tick();
    expect(client.setRoots).toHaveBeenCalledWith([
      ...roots,
      { uri: "file:///c", name: "c" },
    ]);
  });

  it("refuses a root without a URI and returns to the list", async () => {
    const { stdin, client, onClose } = renderModal({});
    await tick();
    stdin.write("+");
    await tick();
    setSubmitValue({ uri: "" });
    stdin.write("\r");
    await tick();
    expect(client.setRoots).not.toHaveBeenCalled();
    // Back on the list, Esc closes.
    stdin.write(ESC);
    await tick();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("backs out of the form with Esc before closing", async () => {
    const { stdin, onClose } = renderModal({});
    await tick();
    stdin.write("n");
    await tick();
    stdin.write("x"); // the form owns this key, so nothing is removed
    await tick();
    stdin.write(ESC);
    await tick();
    expect(onClose).not.toHaveBeenCalled();
    stdin.write(ESC);
    await tick();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the form open and reports a failed save", async () => {
    const setRoots = vi.fn(async () => {
      throw new Error("Client is not connected");
    });
    const { stdin } = renderModal({ inspectorClient: fakeClient(setRoots) });
    await tick();
    stdin.write("x");
    await tick();
    expect(setRoots).toHaveBeenCalledTimes(1);
  });

  it("reports a non-Error failure", async () => {
    const setRoots = vi.fn(() => Promise.reject("nope"));
    const { stdin } = renderModal({ inspectorClient: fakeClient(setRoots) });
    await tick();
    stdin.write("x");
    await tick();
    expect(setRoots).toHaveBeenCalledTimes(1);
  });

  it("ignores keys while a save is in flight", async () => {
    let release: () => void = () => {};
    const setRoots = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const { stdin } = renderModal({ inspectorClient: fakeClient(setRoots) });
    await tick();
    stdin.write("x");
    await tick();
    stdin.write("x");
    await tick();
    expect(setRoots).toHaveBeenCalledTimes(1);
    release();
    await tick();
  });

  it("is read-only while disconnected", async () => {
    const { stdin, client } = renderModal({ connected: false });
    await tick();
    stdin.write("n");
    await tick();
    stdin.write("x");
    await tick();
    expect(client.setRoots).not.toHaveBeenCalled();
  });

  it("does nothing on an empty list or without a client", async () => {
    const { stdin, client } = renderModal({ roots: [] });
    await tick();
    stdin.write("x");
    await tick();
    expect(client.setRoots).not.toHaveBeenCalled();

    const noClient = renderModal({ inspectorClient: null });
    await tick();
    noClient.stdin.write("x");
    await tick();
  });
});
