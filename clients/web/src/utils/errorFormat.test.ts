import { describe, expect, it } from "vitest";
import { errorCodeOf, errorMessage, formatErrorDetails } from "./errorFormat";

describe("errorMessage", () => {
  it("returns an Error's message", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("stringifies a non-Error", () => {
    expect(errorMessage("plain string")).toBe("plain string");
    expect(errorMessage(undefined)).toBe("undefined");
    expect(errorMessage(42)).toBe("42");
  });

  // #2490: the result is shown on screen, so URL query secrets are redacted.
  it("redacts query secrets in a URL quoted by the message", () => {
    const out = errorMessage(
      new Error("Callback https://srv.example/cb?code=abc123&state=ok failed."),
    );
    expect(out).toBe(
      "Callback https://srv.example/cb?code=%5BREDACTED%5D&state=ok failed.",
    );
    expect(errorMessage("see https://s.example/?access_token=zzz")).toBe(
      "see https://s.example/?access_token=%5BREDACTED%5D",
    );
  });
});

describe("errorCodeOf", () => {
  it("reads a numeric `code` off a protocol error", () => {
    expect(
      errorCodeOf(Object.assign(new Error("nope"), { code: -32602 })),
    ).toBe(-32602);
  });

  it("returns undefined for a plain Error", () => {
    expect(errorCodeOf(new Error("plain"))).toBeUndefined();
  });

  it("returns undefined when `code` is not a number", () => {
    expect(errorCodeOf({ code: "-32602" })).toBeUndefined();
  });

  it("returns undefined for non-objects", () => {
    expect(errorCodeOf(null)).toBeUndefined();
    expect(errorCodeOf("boom")).toBeUndefined();
  });
});

describe("formatErrorDetails", () => {
  it("redacts query secrets in the message and data it prints (#2490)", () => {
    const err = Object.assign(new Error("at https://s.example/?code=abc123"), {
      code: -32000,
      data: { url: "https://s.example/?client_secret=shh" },
    });
    const out = formatErrorDetails(err);
    expect(out).not.toContain("abc123");
    expect(out).not.toContain("shh");
    expect(out).toContain("%5BREDACTED%5D");
  });

  it("pretty-prints code/message/data when a code is present", () => {
    const err = Object.assign(new Error("bad params"), {
      code: -32602,
      data: { field: "uri" },
    });
    expect(JSON.parse(formatErrorDetails(err))).toEqual({
      code: -32602,
      message: "bad params",
      data: { field: "uri" },
    });
  });

  it("pretty-prints when only `data` is present", () => {
    expect(
      JSON.parse(formatErrorDetails({ data: [1, 2], message: "m" })),
    ).toEqual({ message: "m", data: [1, 2] });
  });

  it("falls back to the plain message for a bare Error", () => {
    expect(formatErrorDetails(new Error("just a message"))).toBe(
      "just a message",
    );
  });

  it("falls back to String() for a non-object", () => {
    expect(formatErrorDetails("boom")).toBe("boom");
    expect(formatErrorDetails(null)).toBe("null");
  });
});
