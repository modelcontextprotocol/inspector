import { describe, it, expect, vi, afterEach } from "vitest";
import {
  expandTemplate,
  previewTemplate,
  templateVariableNames,
} from "@inspector/core/uri/uriTemplate.js";

afterEach(() => {
  vi.restoreAllMocks();
});

/** Suppress the console.warn a malformed template emits. */
function silenceWarn() {
  return vi.spyOn(console, "warn").mockImplementation(() => {});
}

describe("templateVariableNames", () => {
  it("finds a simple variable", () => {
    expect(templateVariableNames("foobar://events/{topic}")).toEqual(["topic"]);
  });

  it("finds a variable inside a query expression", () => {
    expect(templateVariableNames("foobar://events{?topic}")).toEqual(["topic"]);
  });

  it.each([
    ["reserved", "x://{+path}", ["path"]],
    ["fragment", "x://a{#frag}", ["frag"]],
    ["path segment", "x://a{/seg}", ["seg"]],
    ["label", "x://a{.ext}", ["ext"]],
    ["query continuation", "x://a?x=1{&y}", ["y"]],
  ])("finds a variable in a %s expression", (_label, template, expected) => {
    expect(templateVariableNames(template)).toEqual(expected);
  });

  it("finds every variable in a multi-variable expression", () => {
    expect(templateVariableNames("foobar://e{?a,b}")).toEqual(["a", "b"]);
  });

  it("returns a repeated name once", () => {
    expect(templateVariableNames("x://{a}/{b}/{a}")).toEqual(["a", "b"]);
  });

  // The SDK's UriTemplate does not implement prefix modifiers: it treats
  // `topic:3` as the whole variable name rather than a 3-char prefix of
  // `topic`. Pinned here because that boundary is what the panel renders as a
  // field label, and it is shared with the TUI and readResourceFromTemplate.
  it("treats a prefix modifier as part of the variable name", () => {
    expect(templateVariableNames("x://{topic:3}")).toEqual(["topic:3"]);
  });

  it("returns an empty list for a template with no expressions", () => {
    expect(templateVariableNames("foobar://events")).toEqual([]);
  });

  it("returns an empty list for a malformed template", () => {
    const warn = silenceWarn();
    expect(templateVariableNames("x://{unterminated")).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });

  // The SDK *accepts* these: `new UriTemplate("x://{}")` parses, reports no
  // variables, and expands to `x://`. Left alone, the panel would render no
  // inputs, find its "all filled" check vacuously true, and submit a URI that
  // is not the template the server advertised.
  it.each([
    ["no name", "x://{}"],
    ["a blank name", "x://{ }"],
    ["only a separator", "x://{,}"],
    ["a missing member", "x://{a,}"],
    ["an operator and no name", "x://{?}"],
  ])("rejects an expression with %s", (_label, template) => {
    silenceWarn();
    expect(templateVariableNames(template)).toEqual([]);
    expect(expandTemplate(template, { a: "1" })).toBeNull();
  });
});

describe("expandTemplate", () => {
  it("percent-encodes a reserved character in a simple variable", () => {
    expect(
      expandTemplate("foobar://events/{topic}", { topic: "foo/bar" }),
    ).toBe("foobar://events/foo%2Fbar");
  });

  it("expands a query expression", () => {
    expect(
      expandTemplate("foobar://events{?topic}", { topic: "foo/bar" }),
    ).toBe("foobar://events?topic=foo%2Fbar");
  });

  it.each([
    ["?", "x://e/%3F"],
    ["#", "x://e/%23"],
    ["%", "x://e/%25"],
    [" ", "x://e/%20"],
    ["café", "x://e/caf%C3%A9"],
  ])("encodes %j", (value, expected) => {
    expect(expandTemplate("x://e/{v}", { v: value })).toBe(expected);
  });

  it("leaves a reserved-expansion value's sub-delimiters intact", () => {
    expect(expandTemplate("x://{+path}", { path: "a/b" })).toBe("x://a/b");
  });

  // The SDK's own encoding is not RFC-conformant, and every case below is
  // reachable from a plain text input. Simple and query expansions go through
  // `encodeURIComponent`, which leaves these five bare; RFC 6570 §3.2.1 encodes
  // everything outside the *unreserved* set.
  describe("RFC 3986 character sets", () => {
    it.each([
      ["!", "%21"],
      ["*", "%2A"],
      ["'", "%27"],
      ["(", "%28"],
      [")", "%29"],
    ])("encodes %j in a simple expansion", (value, encoded) => {
      expect(expandTemplate("x://{v}", { v: value })).toBe(`x://${encoded}`);
    });

    it("encodes them in a query expansion too", () => {
      expect(expandTemplate("x://e{?v}", { v: "!*'()" })).toBe(
        "x://e?v=%21%2A%27%28%29",
      );
    });

    // `+` and `#` use `encodeURI`, which escapes `[` and `]` — but those are
    // gen-delims, exactly what reserved expansion exists to pass through.
    it.each([
      ["reserved", "x://{+v}", "x://[a]"],
      ["fragment", "x://{#v}", "x://#[a]"],
    ])("keeps gen-delims in a %s expansion", (_label, template, expected) => {
      expect(expandTemplate(template, { v: "[a]" })).toBe(expected);
    });

    it("keeps every reserved character under the + operator", () => {
      const reserved = ":/?#[]@!$&'()*+,;=";
      expect(expandTemplate("x://{+v}", { v: reserved })).toBe(
        `x://${reserved}`,
      );
    });

    // A well-formed triplet is already pct-encoded; the SDK re-encoded it to
    // `%2541`, which changes the value.
    it("passes an existing pct-triplet through a reserved expansion", () => {
      expect(expandTemplate("x://{+v}", { v: "%41" })).toBe("x://%41");
    });

    it("encodes a bare percent that is not a triplet", () => {
      expect(expandTemplate("x://{+v}", { v: "100%" })).toBe("x://100%25");
      expect(expandTemplate("x://{+v}", { v: "%zz" })).toBe("x://%25zz");
    });

    // A simple expansion has no triplet passthrough — the value is literal.
    it("encodes a percent in a simple expansion", () => {
      expect(expandTemplate("x://{v}", { v: "%41" })).toBe("x://%2541");
    });

    it("encodes a code point outside the BMP as its UTF-8 octets", () => {
      expect(expandTemplate("x://{v}", { v: "😀" })).toBe("x://%F0%9F%98%80");
    });

    // An unpaired surrogate has no UTF-8 encoding and makes
    // `encodeURIComponent` throw `URIError`. Encoding runs outside the SDK's
    // try/catch — and, through the preview, during render — so it must be
    // reported rather than thrown.
    it.each([
      ["a lone high surrogate", "\uD800"],
      ["a lone low surrogate", "\uDC00"],
      ["a surrogate among valid text", "ok\uD800ok"],
    ])("declines %s instead of throwing", (_label, value) => {
      silenceWarn();
      expect(() => expandTemplate("x://{v}", { v: value })).not.toThrow();
      expect(expandTemplate("x://{v}", { v: value })).toBeNull();
    });

    it("previews a lone surrogate as the raw template instead of throwing", () => {
      silenceWarn();
      expect(previewTemplate("x://{v}", { v: "\uD800" })).toBe("x://{v}");
    });
  });

  // RFC 6570 allows one name in expressions with different operators, and each
  // occurrence encodes per *its* operator. A single value keyed by name cannot
  // express that, so each occurrence gets its own rendering.
  describe("a name repeated under different operators", () => {
    // `-` as the literal separator, so the slashes in the output are only ever
    // the ones the expansion produced.
    it("encodes each occurrence per its own operator", () => {
      expect(expandTemplate("x://{+a}-{a}", { a: "/" })).toBe("x:///-%2F");
    });

    it("still offers the repeated name as one field", () => {
      expect(templateVariableNames("x://{+a}-{a}")).toEqual(["a"]);
    });

    it("handles a simple/query pair", () => {
      expect(expandTemplate("x://{+a}{?a}", { a: "a/b" })).toBe(
        "x://a/b?a=a%2Fb",
      );
    });

    it("handles a fragment/simple pair", () => {
      expect(expandTemplate("x://{a}{#a}", { a: "[x]" })).toBe(
        "x://%5Bx%5D#[x]",
      );
    });
  });

  // RFC 6570 distinguishes an *undefined* variable from one defined as the
  // empty string, and the expansion must not collapse the two.
  it("keeps a variable defined as the empty string", () => {
    expect(expandTemplate("foobar://events{?topic}", { topic: "" })).toBe(
      "foobar://events?topic=",
    );
  });

  it("omits a variable that is absent from the values entirely", () => {
    expect(expandTemplate("foobar://e{?a,b}", { a: "1" })).toBe(
      "foobar://e?a=1",
    );
  });

  // The SDK's multi-name branch skips both encoding and the operator, so these
  // expressions are rewritten to a single array-valued variable, which takes
  // the branch that applies them.
  //
  // Covered here rather than in the integration suite on purpose: the SDK's
  // `UriTemplate.match` cannot match a multi-name expression *either* (it
  // returns null for every URI), so an SDK-based server can never route one and
  // there is no round trip to drive. What the client can do is emit the
  // spec-correct URI, which is what a conforming server needs — so that is what
  // these assert.
  describe("multi-name expressions", () => {
    it.each([
      ["simple", "x://{a,b}", "x://foo%2Fbar,x%20y"],
      // `#`, like `+`, is a *reserved* expansion — `/` survives, a space does not.
      ["fragment", "x://e{#a,b}", "x://e#foo/bar,x%20y"],
      ["label", "x://e{.a,b}", "x://e.foo%2Fbar.x%20y"],
      ["path segment", "x://e{/a,b}", "x://e/foo%2Fbar/x%20y"],
    ])("encodes and applies the operator for a %s group", (_l, t, expected) => {
      expect(expandTemplate(t, { a: "foo/bar", b: "x y" })).toBe(expected);
    });

    it("preserves reserved characters under the + operator", () => {
      expect(expandTemplate("x://{+a,b}", { a: "foo/bar", b: "x y" })).toBe(
        "x://foo/bar,x%20y",
      );
    });

    it("still expands a multi-name query expression correctly", () => {
      expect(expandTemplate("x://e{?a,b}", { a: "foo/bar", b: "x y" })).toBe(
        "x://e?a=foo%2Fbar&b=x%20y",
      );
    });

    it("drops an undefined member from the group", () => {
      expect(expandTemplate("x://{a,b}", { b: "two" })).toBe("x://two");
    });

    it("omits the whole expression when no member is defined", () => {
      expect(expandTemplate("x://e{#a,b}", {})).toBe("x://e");
    });

    // The projection copies every supplied variable, so a caller passing a key
    // equal to the generated synthetic name must not have it stand in for the
    // group — the SDK ignores undeclared variables, and so must this.
    it("ignores a caller value keyed like the synthetic group name", () => {
      expect(
        expandTemplate("x://{a,b}", { __inspectorGroup0__: "injected" }),
      ).toBe("x://");
    });

    // `variableNames` strips a trailing `*`, so the form stores `a`. A group
    // that kept `a*` would look up a key the form never sets and silently drop
    // a filled value.
    it("matches the SDK's name for an exploded member", () => {
      expect(templateVariableNames("x://e{/a*,b}")).toEqual(["a", "b"]);
      expect(expandTemplate("x://e{/a*,b}", { a: "one", b: "two" })).toBe(
        "x://e/one/two",
      );
    });

    // A template may legitimately declare a variable named like the synthetic
    // one; the rewrite must not overwrite the user's value with the group's.
    it("does not collide with a variable named like the synthetic one", () => {
      expect(
        expandTemplate("x://{a,b}/{__inspectorGroup0__}", {
          a: "one",
          b: "two",
          __inspectorGroup0__: "mine",
        }),
      ).toBe("x://one,two/mine");
    });
  });

  // The SDK does not implement `;`: it reads `{;a}` as a variable literally
  // named ";a" and expands it to the bare value, dropping the required `;a=`.
  // No arrangement of its branches produces the right output, so decline rather
  // than hand back a URI known to be invalid.
  describe("the unsupported ; (path-parameter) operator", () => {
    it.each([
      ["single-name", "x://e{;a}"],
      ["multi-name", "x://e{;a,b}"],
    ])("returns null for a %s expression", (_label, template) => {
      silenceWarn();
      expect(expandTemplate(template, { a: "1", b: "2" })).toBeNull();
    });

    it("previews it as the template the server declared", () => {
      expect(previewTemplate("x://e{;a,b}", { a: "1" })).toBe("x://e{;a,b}");
    });

    it("does not mistake a literal semicolon for the operator", () => {
      expect(expandTemplate("x://e;q/{a}", { a: "1" })).toBe("x://e;q/1");
    });
  });

  it("returns null when the template cannot be parsed", () => {
    silenceWarn();
    expect(expandTemplate("x://{unterminated", { a: "1" })).toBeNull();
  });

  // Parsing succeeding does not mean expanding will — the SDK checks its
  // per-value length ceiling at expansion time.
  it("returns null when a value cannot be expanded", () => {
    silenceWarn();
    expect(expandTemplate("x://{a}", { a: "z".repeat(1_000_001) })).toBeNull();
  });
});

describe("previewTemplate", () => {
  // The preview's own notion, deliberately different from expandTemplate's: a
  // text input cannot express "defined but empty", so within the preview an
  // empty string means "not entered yet".
  it("treats an empty string as unfilled rather than as an empty expansion", () => {
    expect(expandTemplate("x://e{?t}", { t: "" })).toBe("x://e?t=");
    expect(previewTemplate("x://e{?t}", { t: "" })).toBe("x://e?t={t}");
  });

  it("shows an unfilled simple variable as its expression", () => {
    expect(previewTemplate("foobar://events/{topic}", { topic: "" })).toBe(
      "foobar://events/{topic}",
    );
  });

  it("shows an unfilled query variable as its expression", () => {
    expect(previewTemplate("foobar://events{?topic}", { topic: "" })).toBe(
      "foobar://events?topic={topic}",
    );
  });

  it("shows a filled value encoded exactly as it will be sent", () => {
    expect(
      previewTemplate("foobar://events/{topic}", { topic: "foo/bar" }),
    ).toBe("foobar://events/foo%2Fbar");
  });

  it("mixes filled and unfilled variables", () => {
    expect(previewTemplate("x://{a}/{b}", { a: "one", b: "" })).toBe(
      "x://one/{b}",
    );
  });

  it("substitutes every occurrence of a repeated unfilled name", () => {
    expect(previewTemplate("x://{a}/{b}/{a}", { a: "", b: "2" })).toBe(
      "x://{a}/2/{a}",
    );
  });

  // The placeholder token for variable 1 must not be a prefix of the one for
  // variable 11, or substituting the former would corrupt the latter.
  it("keeps double-digit variable positions distinct", () => {
    const names = Array.from({ length: 12 }, (_, i) => `v${i}`);
    const template = `x://${names.map((n) => `{${n}}`).join("/")}`;
    const empty = Object.fromEntries(names.map((n) => [n, ""]));
    expect(previewTemplate(template, empty)).toBe(template);
  });

  // A prefix modifier does not truncate here — the SDK folds it into the
  // variable name (see the discovery test above) — so the sentinel survives
  // expansion intact and the placeholder is restored like any other.
  it("restores the placeholder for a variable carrying a prefix modifier", () => {
    expect(previewTemplate("x://{topic:3}", {})).toBe("x://{topic:3}");
    expect(previewTemplate("x://{?topic:3}", {})).toBe(
      "x://?topic:3={topic:3}",
    );
  });

  // A filled value that happens to be the placeholder token must not be
  // rewritten into a `{name}` — that would make the preview disagree with the
  // URI actually submitted.
  it("does not mistake a filled value for its own placeholder", () => {
    expect(
      previewTemplate("x://{a}/{b}", { a: "zzInspectorUnfilledzz1zz", b: "" }),
    ).toBe("x://zzInspectorUnfilledzz1zz/{b}");
  });

  it("does not mistake the template's own literal text for a placeholder", () => {
    expect(previewTemplate("x://zzInspectorUnfilledzz0zz/{a}", { a: "" })).toBe(
      "x://zzInspectorUnfilledzz0zz/{a}",
    );
  });

  it("shows a placeholder per member of a multi-name group", () => {
    expect(previewTemplate("x://{a,b}", { a: "one", b: "" })).toBe(
      "x://one,{b}",
    );
  });

  it("returns the raw template when it cannot be parsed", () => {
    silenceWarn();
    expect(previewTemplate("x://{unterminated", {})).toBe("x://{unterminated");
  });

  // Must not throw out of render — the panel expands its preview while
  // rendering, so an escaping error would unmount the panel.
  it("returns the raw template when a value cannot be expanded", () => {
    silenceWarn();
    expect(previewTemplate("x://{a}", { a: "z".repeat(1_000_001) })).toBe(
      "x://{a}",
    );
  });

  // A template holding the token followed by a long run of `z`s used to make
  // every extended candidate collide in turn, rescanning the whole input each
  // time. The base is now cleared in a single pass.
  it("resolves a padded-run collision without rescanning", () => {
    const template = `x://zzInspectorUnfilledzz${"z".repeat(5000)}/{a}`;
    expect(previewTemplate(template, { a: "" })).toBe(template);
  });

  // Substitution is one regex pass over the expansion rather than one pass per
  // variable — the SDK accepts a 1 MB template with up to 10,000 expressions,
  // and a per-variable rescan is O(variables × length) during render. This also
  // covers the multi-digit index boundary at scale.
  it("substitutes many variables correctly", () => {
    const names = Array.from({ length: 200 }, (_, i) => `v${i}`);
    const template = `x://${names.map((n) => `{${n}}`).join("/")}`;
    const values = Object.fromEntries(
      names.map((n, i) => [n, i % 2 === 0 ? `val${i}` : ""]),
    );
    const expected = `x://${names
      .map((n, i) => (i % 2 === 0 ? `val${i}` : `{${n}}`))
      .join("/")}`;
    expect(previewTemplate(template, values)).toBe(expected);
  });

  // The token starts and ends with `zz`, so it can overlap itself: this literal
  // holds a second occurrence at index 19 whose trailing run is the longer one.
  // A scan advancing by the token's length would miss it and pick a colliding
  // placeholder, rewriting literal URI text into `{a}`.
  it("measures an overlapping occurrence of the token", () => {
    const template = "x://zzInspectorUnfilledzzInspectorUnfilledzzz0zz/{a}";
    expect(previewTemplate(template, { a: "" })).toBe(template);
  });
});
