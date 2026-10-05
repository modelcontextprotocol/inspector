import { describe, it, expect } from "vitest";
import {
  errorMessage,
  redactErrorText,
  redactedJson,
} from "../src/utils/errorText.js";

// #2490: every error the TUI draws goes through these, so a server or SDK
// error quoting a URL with an OAuth code / token never reaches the screen.
const SECRET_URL = "https://srv.example/cb?code=abc123&state=ok";
const REDACTED_URL = "https://srv.example/cb?code=%5BREDACTED%5D&state=ok";

describe("errorMessage", () => {
  it("returns an Error's message, redacted", () => {
    expect(errorMessage(new Error(`Callback ${SECRET_URL} failed.`))).toBe(
      `Callback ${REDACTED_URL} failed.`,
    );
  });

  it("stringifies a non-Error, redacted", () => {
    expect(errorMessage(`at ${SECRET_URL}`)).toBe(`at ${REDACTED_URL}`);
    expect(errorMessage(42)).toBe("42");
    expect(errorMessage(undefined)).toBe("undefined");
  });

  it("leaves text without a sensitive URL untouched", () => {
    expect(errorMessage(new Error("plain failure"))).toBe("plain failure");
  });
});

describe("redactErrorText", () => {
  it("redacts query secrets in free text", () => {
    expect(redactErrorText(`lost ${SECRET_URL}`)).toBe(`lost ${REDACTED_URL}`);
  });
});

describe("redactedJson", () => {
  it("pretty-prints and redacts a URL inside a string value", () => {
    const out = redactedJson({ message: `boom ${SECRET_URL}`, code: -32000 });
    expect(out).toBe(
      JSON.stringify(
        { message: `boom ${REDACTED_URL}`, code: -32000 },
        null,
        2,
      ),
    );
    expect(out).not.toContain("abc123");
  });

  it("falls back to String() when JSON.stringify yields undefined", () => {
    expect(redactedJson(undefined)).toBe("undefined");
  });
});
