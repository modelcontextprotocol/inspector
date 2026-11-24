import { describe, it, expect } from "vitest";
import { ProtocolError } from "@modelcontextprotocol/client";
import {
  classifyTermination,
  eventsErrorOf,
  isTerminalRequestError,
  transportErrorInfo,
  HEADER_MISMATCH_CODE,
} from "@inspector/core/extension/events/termination.js";
import { EVENTS_ERROR_CODES } from "@inspector/core/extension/events/constants.js";

describe("eventsErrorOf (#3029)", () => {
  it("reads a ProtocolError's code, message and data", () => {
    const err = new ProtocolError(EVENTS_ERROR_CODES.NotFound, "NotFound", {
      kind: "event",
    });
    expect(eventsErrorOf(err)).toEqual({
      code: EVENTS_ERROR_CODES.NotFound,
      message: err.message,
      data: { kind: "event" },
    });
  });

  it("is undefined for anything without a numeric code", () => {
    expect(eventsErrorOf(new Error("x"))).toBeUndefined();
    expect(eventsErrorOf({ code: "REQUEST_TIMEOUT", message: "t" })).toBe(
      undefined,
    );
    expect(eventsErrorOf({ code: 1 })).toBeUndefined();
    expect(eventsErrorOf(null)).toBeUndefined();
    expect(eventsErrorOf("x")).toBeUndefined();
    expect(eventsErrorOf({ code: -1, message: "m" })).toEqual({
      code: -1,
      message: "m",
    });
  });
});

describe("isTerminalRequestError (#3029)", () => {
  it("is true for the codes that mean the subscription is invalid", () => {
    for (const code of [
      -32602,
      -32601,
      HEADER_MISMATCH_CODE,
      ...Object.values(EVENTS_ERROR_CODES),
    ]) {
      expect(isTerminalRequestError(code)).toBe(true);
    }
    expect(isTerminalRequestError(-32603)).toBe(false);
    expect(isTerminalRequestError(-32000)).toBe(false);
  });
});

describe("classifyTermination (#3029)", () => {
  const err = (code: number, data?: unknown) => ({ code, message: "m", data });

  it("re-lists for a removed type, an in-place schema change and a header mismatch", () => {
    expect(classifyTermination(err(EVENTS_ERROR_CODES.NotFound))).toEqual({
      reason: "removed",
      relist: true,
    });
    expect(
      classifyTermination(
        err(EVENTS_ERROR_CODES.Unsupported, {
          feature: "payloadSchema",
          reason: "schema_changed",
        }),
      ),
    ).toEqual({ reason: "schema_changed", relist: true });
    expect(classifyTermination(err(HEADER_MISMATCH_CODE))).toEqual({
      reason: "header_mismatch",
      relist: true,
    });
  });

  it("ends without an offer for Forbidden and anything else", () => {
    expect(classifyTermination(err(EVENTS_ERROR_CODES.Forbidden))).toEqual({
      reason: "forbidden",
      relist: false,
    });
    expect(
      classifyTermination(
        err(EVENTS_ERROR_CODES.Unsupported, { feature: "deliveryMode" }),
      ),
    ).toEqual({ reason: "rejected", relist: false });
    expect(classifyTermination(err(EVENTS_ERROR_CODES.Unsupported))).toEqual({
      reason: "rejected",
      relist: false,
    });
    expect(classifyTermination(err(-32602))).toEqual({
      reason: "rejected",
      relist: false,
    });
  });
});

describe("transportErrorInfo (#3029)", () => {
  it("wraps an Error or any other value", () => {
    expect(transportErrorInfo(new Error("down"))).toEqual({
      code: -32603,
      message: "down",
      data: { transport: true },
    });
    expect(transportErrorInfo(42).message).toBe("42");
  });
});
