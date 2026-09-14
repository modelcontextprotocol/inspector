import { describe, it, expect } from "vitest";
import { previewUriTemplate } from "./uriTemplate";

describe("previewUriTemplate", () => {
  it("shows the template verbatim before anything is entered", () => {
    expect(previewUriTemplate("file:///users/{userId}/profile", {})).toBe(
      "file:///users/{userId}/profile",
    );
  });

  it("substitutes only the expressions that are filled", () => {
    expect(
      previewUriTemplate("db://{tableName}/rows/{rowId}", {
        tableName: "users",
        rowId: "",
      }),
    ).toBe("db://users/rows/{rowId}");
  });

  it("encodes the filled values the same way expansion does", () => {
    expect(
      previewUriTemplate("foobar://events/{topic}", { topic: "foo/bar" }),
    ).toBe("foobar://events/foo%2Fbar");
  });

  it("expands a partially-filled multi-name expression, as submitting would", () => {
    // RFC 6570 drops the undefined names rather than the whole expression, so
    // showing `{?one,two}` here would promise a URI the submit does not send.
    expect(previewUriTemplate("x://a{?one,two}", { one: "1" })).toBe(
      "x://a?one=1",
    );
  });

  it("keeps a multi-name expression whole while none of its names is filled", () => {
    expect(previewUriTemplate("x://a{?one,two}", {})).toBe("x://a{?one,two}");
  });

  it("expands each query expression independently, matching the submit", () => {
    // Not `?one=1&two=2` -- see the expander's tests: the SDK's own matcher
    // rejects that for this template. The preview must show what will be sent.
    expect(
      previewUriTemplate("x://a{?one}{?two}", { one: "1", two: "2" }),
    ).toBe("x://a?one=1?two=2");
  });

  it("restores a deferred expression that follows a resolved query expression", () => {
    expect(previewUriTemplate("x://a{?one}{?two}", { one: "1" })).toBe(
      "x://a?one=1{?two}",
    );
  });

  it("falls back to the raw template when the SDK cannot parse it", () => {
    expect(previewUriTemplate("x://a/{oops", {})).toBe("x://a/{oops");
  });
});

describe("previewUriTemplate - multi-name expressions", () => {
  it("applies the same correction the real expansion does", () => {
    // Must match expandUriTemplate("x://{a,b}", ...) exactly, or the preview
    // would promise a URI that submitting does not send.
    expect(previewUriTemplate("x://{a,b}", { a: "foo/bar", b: "q" })).toBe(
      "x://foo%2Fbar,q",
    );
  });
});

describe("preview with Object.prototype-colliding names", () => {
  it("leaves a blank {?toString} standing rather than treating it as filled", () => {
    // A bare `defined[name] !== undefined` finds Object.prototype.toString and
    // would expand the expression instead of showing the placeholder.
    expect(previewUriTemplate("x://a{?toString}", { toString: "" })).toBe(
      "x://a{?toString}",
    );
  });

  it("expands it once it really has a value", () => {
    expect(previewUriTemplate("x://a{?toString}", { toString: "v" })).toBe(
      "x://a?toString=v",
    );
  });
});

describe("previewUriTemplate - literals", () => {
  // The preview promises the URI that submitting would send, so it applies the
  // same RFC 6570 3.1 literal encoding the wire does.
  it("percent-encodes a non-ASCII literal", () => {
    expect(previewUriTemplate("café/{var}", { var: "value" })).toBe(
      "caf%C3%A9/value",
    );
  });

  it("encodes the literal even while an expression is still unfilled", () => {
    expect(previewUriTemplate("café/{var}", {})).toBe("caf%C3%A9/{var}");
  });

  it("shows a template the read would refuse exactly as the server wrote it", () => {
    // Not even the literal is encoded: an unreadable template is displayed
    // verbatim rather than half-normalized into something never published.
    expect(previewUriTemplate("x://café/{oops", {})).toBe("x://café/{oops");
  });
});

describe("previewUriTemplate - it must never throw or over-promise", () => {
  // Both of these were free when the preview expanded a rewritten template
  // through the lenient `expandUriTemplate`; assembling part by part has to
  // reinstate them explicitly.
  it("falls back to the raw template when a value cannot be encoded", () => {
    // An unpaired surrogate has no UTF-8 encoding, so `encodeURIComponent`
    // raises URIError -- and this runs during render, where an escaping throw
    // unmounts the panel rather than disabling its button. A paste delivers it.
    expect(previewUriTemplate("x://{v}", { v: "\ud800" })).toBe("x://{v}");
  });

  it("leaves an invalid expression standing rather than expanding it", () => {
    // `{a,}` keeps `a` in its varspecs, so expanding it would preview a URI
    // for a template whose submission is refused outright.
    expect(previewUriTemplate("x://{a,}", { a: "1" })).toBe("x://{a,}");
    expect(previewUriTemplate("x://{id:abc}", { "id:abc": "1" })).toBe(
      "x://{id:abc}",
    );
  });

  it.each([
    ["an invalid varspec", "x://{a,}/{b}"],
    ["a stray closing brace", "x://{a}}/{b}"],
  ])(
    "does not expand the valid expressions around %s either",
    (_label, template) => {
      // The refusal is per TEMPLATE, not per expression: every read of these
      // is refused, so previewing `x://{a,}/2` or `x://1}/2` would promise a
      // URI this form can never send. An earlier revision did exactly that.
      expect(previewUriTemplate(template, { a: "1", b: "2" })).toBe(template);
    },
  );
});

describe("previewUriTemplate - the value ceiling", () => {
  it("falls back before encoding an oversized value", () => {
    // Without this the guard was half a guard: the read was refused while the
    // preview still encoded the same value on every keystroke, so a large
    // paste froze the UI anyway.
    expect(previewUriTemplate("x://{v}", { v: "a".repeat(1_000_001) })).toBe(
      "x://{v}",
    );
  });

  it("ignores an oversized value the template never references", () => {
    expect(
      previewUriTemplate("x://{id}", {
        id: "7",
        stale: "a".repeat(1_000_001),
      }),
    ).toBe("x://7");
  });

  it("still previews a value at the limit", () => {
    const value = "a".repeat(1_000_000);
    expect(previewUriTemplate("x://{v}", { v: value })).toBe(`x://${value}`);
  });
});
