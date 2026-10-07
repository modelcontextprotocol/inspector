import { describe, expect, it } from "vitest";
import { ProtocolError, ProtocolErrorCode } from "@modelcontextprotocol/client";
import {
  DispatchError,
  JsonRpcResponseError,
  TaskFailedError,
} from "@modelcontextprotocol/ext-tasks/client";
import {
  abortError,
  toProtocolError,
  unwrapTaskDispatchError,
} from "@inspector/core/extension/tasks/errors.js";

describe("abortError", () => {
  it("returns the signal's own Error reason", () => {
    const reason = new Error("stop");
    const controller = new AbortController();
    controller.abort(reason);
    expect(abortError(controller.signal)).toBe(reason);
  });

  it("builds an AbortError when the reason is not an Error", () => {
    const controller = new AbortController();
    controller.abort("user cancelled");
    const error = abortError(controller.signal);
    expect(error.name).toBe("AbortError");
  });
});

describe("unwrapTaskDispatchError", () => {
  it("restores a DispatchError's Error cause", () => {
    const cause = new Error("socket closed");
    expect(
      unwrapTaskDispatchError(new DispatchError("wrapped", false, { cause })),
    ).toBe(cause);
  });

  it("leaves a DispatchError without an Error cause as is", () => {
    const error = new DispatchError("bare");
    expect(unwrapTaskDispatchError(error)).toBe(error);
  });

  it("maps a JSON-RPC response error to a ProtocolError", () => {
    const unwrapped = unwrapTaskDispatchError(
      new JsonRpcResponseError({ code: -32602, message: "bad", data: 1 }),
    );
    expect(unwrapped).toBeInstanceOf(ProtocolError);
    expect(unwrapped).toMatchObject({ code: -32602, data: 1 });
  });

  it("maps a coded task failure to a ProtocolError, uncoded passes through", () => {
    expect(
      unwrapTaskDispatchError(new TaskFailedError("boom", { code: -32000 })),
    ).toMatchObject({ code: -32000 });
    const uncoded = new TaskFailedError("boom");
    expect(unwrapTaskDispatchError(uncoded)).toBe(uncoded);
  });
});

describe("toProtocolError", () => {
  it("keeps a ProtocolError and wraps anything else as InternalError", () => {
    const protocol = new ProtocolError(-32601, "missing");
    expect(toProtocolError(protocol)).toBe(protocol);
    expect(toProtocolError(new Error("plain"))).toMatchObject({
      code: ProtocolErrorCode.InternalError,
      message: expect.stringContaining("plain"),
    });
    expect(toProtocolError("text")).toMatchObject({
      code: ProtocolErrorCode.InternalError,
      message: expect.stringContaining("text"),
    });
  });
});
