import { describe, it, expect } from "vitest";
import {
  definedValues,
  expandUriTemplate,
  expandUriTemplateStrict,
  hasRequiredValues,
  parseUriTemplate,
  requiredGroups,
  templateVariables,
  templateError,
  tryExpandUriTemplate,
  unmetRequiredGroups,
  valueLengthError,
} from "@inspector/core/mcp/uriTemplate.js";

describe("parseUriTemplate", () => {
  it("splits literals from expressions", () => {
    expect(parseUriTemplate("foobar://events/{topic}")).toEqual([
      { kind: "literal", text: "foobar://events/" },
      {
        kind: "expression",
        source: "{topic}",
        operator: "",
        varspecs: [{ name: "topic" }],
        names: ["topic"],
        invalid: false,
      },
    ]);
  });

  it("reads the operator and the comma-separated name list", () => {
    expect(parseUriTemplate("x://{?a,b*}")).toEqual([
      { kind: "literal", text: "x://" },
      {
        kind: "expression",
        source: "{?a,b*}",
        operator: "?",
        varspecs: [{ name: "a" }, { name: "b" }],
        names: ["a", "b"],
        invalid: false,
      },
    ]);
  });

  it("treats an unclosed expression as trailing literal text", () => {
    expect(parseUriTemplate("x://a/{oops")).toEqual([
      { kind: "literal", text: "x://a/{oops" },
    ]);
  });

  it("returns nothing for an empty template", () => {
    expect(parseUriTemplate("")).toEqual([]);
  });
});

describe("templateVariables", () => {
  it("finds a simple variable and marks it required", () => {
    expect(templateVariables("foobar://events/{topic}")).toEqual([
      { name: "topic", operator: "", required: true, conforming: true },
    ]);
  });

  it("finds a query variable the old `\\{(\\w+)\\}` regex could not see", () => {
    expect(templateVariables("foobar://events{?topic}")).toEqual([
      { name: "topic", operator: "?", required: false, conforming: true },
    ]);
  });

  // Required iff omitting the variable leaves an empty slot mid-URI rather
  // than a shorter, still-well-formed URI. Verified against the pinned SDK:
  // `x://a/{+path}` with no `path` expands to "x://a/" (empty segment), while
  // `x://a{#frag}` expands to exactly "x://a".
  it.each([
    ["{+path}", "+", true],
    ["{#frag}", "#", false],
    ["{.label}", ".", false],
    ["{/segment}", "/", false],
    ["{&extra}", "&", false],
  ])("classifies %s", (expression, operator, required) => {
    const [variable] = templateVariables(`x://a${expression}`);
    expect(variable.operator).toBe(operator);
    expect(variable.required).toBe(required);
  });

  it("deduplicates a repeated name and keeps it required if any use is", () => {
    expect(templateVariables("x://{?id}/{id}")).toEqual([
      { name: "id", operator: "?", required: true, conforming: true },
    ]);
  });

  it.each([
    ["file:///users/{userId}/profile", "file:///users//profile"],
    ["x://a/{+path}", "x://a/"],
  ])(
    "requires %s because omitting it leaves an empty slot (%s)",
    (template, omitted) => {
      expect(templateVariables(template)[0].required).toBe(true);
      // The reason, asserted rather than asserted-about: this is what the URI
      // would become if the field were left blank.
      expect(expandUriTemplate(template, {})).toBe(omitted);
    },
  );

  it("does not require {#frag}, which omits to a well-formed URI", () => {
    expect(templateVariables("x://a{#frag}")[0].required).toBe(false);
    expect(expandUriTemplate("x://a{#frag}", {})).toBe("x://a");
  });

  it("returns an empty list for a template with no expressions", () => {
    expect(templateVariables("file:///static.txt")).toEqual([]);
  });
});

describe("expandUriTemplate", () => {
  it("percent-encodes a reserved character in a simple variable (#1919)", () => {
    expect(
      expandUriTemplate("foobar://events/{topic}", { topic: "foo/bar" }),
    ).toBe("foobar://events/foo%2Fbar");
  });

  it.each([
    ["?", "a?b", "a%3Fb"],
    ["#", "a#b", "a%23b"],
    ["%", "a%b", "a%25b"],
    ["space", "a b", "a%20b"],
    ["unicode", "caffè", "caff%C3%A8"],
  ])("encodes %s", (_label, value, encoded) => {
    expect(expandUriTemplate("x://{v}", { v: value })).toBe(`x://${encoded}`);
  });

  it("builds an encoded query expression", () => {
    expect(
      expandUriTemplate("foobar://events{?topic}", { topic: "foo/bar" }),
    ).toBe("foobar://events?topic=foo%2Fbar");
  });

  it("leaves reserved characters intact under the + operator", () => {
    expect(expandUriTemplate("x://{+path}", { path: "a/b" })).toBe("x://a/b");
  });

  it("omits an expression whose variable is undefined", () => {
    expect(expandUriTemplate("foobar://events{?topic}", {})).toBe(
      "foobar://events",
    );
    // A form's untouched field arrives as "", which is a *defined* value; the
    // form drops it on the way in. See "a value defined as the empty string".
    expect(
      expandUriTemplate(
        "foobar://events{?topic}",
        definedValues({ topic: "" }),
      ),
    ).toBe("foobar://events");
  });

  it("expands each query expression independently, per RFC 6570", () => {
    // NOT `?one=1&two=2`. The SDK rewrites the second `?` to `&`, but measured
    // against the pinned SDK its own matcher then rejects the result:
    // match("x?one=1&two=2") on `x{?one}{?two}` is null, while
    // match("x?one=1?two=2") returns both variables. A server wanting a
    // continuation advertises `{?one}{&two}` -- see the test below.
    expect(expandUriTemplate("x://a{?one}{?two}", { one: "1", two: "2" })).toBe(
      "x://a?one=1?two=2",
    );
  });

  it("emits & only where the template asks for the continuation operator", () => {
    expect(expandUriTemplate("x://a{?one}{&two}", { one: "1", two: "2" })).toBe(
      "x://a?one=1&two=2",
    );
  });

  it("falls back to the raw template when the SDK cannot parse it", () => {
    expect(expandUriTemplate("x://a/{oops", { oops: "v" })).toBe("x://a/{oops");
  });
});

describe("expandUriTemplate - multi-name expressions (SDK correction)", () => {
  // The pinned SDK's `expandPart` takes an early `names.length > 1` branch that
  // raw-joins the values, skipping BOTH encodeValue and the operator prefix.
  // Measured directly: `x://{a,b}` -> "x://foo/bar,q", `x://a{/p,q}` ->
  // "x://ax y,z". These assert the corrected output.
  it("encodes each value in a simple multi-name expression", () => {
    expect(expandUriTemplate("x://{a,b}", { a: "foo/bar", b: "q" })).toBe(
      "x://foo%2Fbar,q",
    );
  });

  it("keeps the / operator prefix and separator, and encodes", () => {
    expect(expandUriTemplate("x://a{/p,q}", { p: "x y", q: "z" })).toBe(
      "x://a/x%20y/z",
    );
  });

  it("keeps the . operator prefix and separator", () => {
    expect(expandUriTemplate("x://a{.p,q}", { p: "x/y", q: "z" })).toBe(
      "x://a.x%2Fy.z",
    );
  });

  it("keeps the # prefix and leaves reserved characters under it", () => {
    expect(expandUriTemplate("x://a{#p,q}", { p: "x/y", q: "z" })).toBe(
      "x://a#x/y,z",
    );
  });

  it("leaves reserved characters under the + operator", () => {
    expect(expandUriTemplate("x://{+a,b}", { a: "x/y", b: "z" })).toBe(
      "x://x/y,z",
    );
  });

  it("drops only the undefined names, keeping the rest", () => {
    expect(expandUriTemplate("x://a{/p,q}", { q: "z" })).toBe("x://a/z");
  });

  it("omits the whole expression when no name has a value", () => {
    expect(expandUriTemplate("x://a{/p,q}", {})).toBe("x://a");
  });

  // Naming, not delegation: a multi-name QUERY expression pairs each name with
  // its own value and joins with `&` (RFC 6570 §3.2.8), unlike the bare
  // comma-joined list every non-named operator above produces.
  it("pairs each name with its value in a multi-name query expression", () => {
    expect(expandUriTemplate("x://a{?p,q}", { p: "x/y", q: "z" })).toBe(
      "x://a?p=x%2Fy&q=z",
    );
  });
});

describe("varspec modifiers", () => {
  // The pinned SDK folds a `:length` modifier into the variable name --
  // `new UriTemplate("x://a/{id:3}").variableNames` is `["id:3"]`, and it
  // expands to "x://a/" -- so a form built on it would render a field the
  // user cannot usefully fill.
  it("parses a prefix modifier off the variable name", () => {
    expect(templateVariables("x://a/{id:3}")).toEqual([
      { name: "id", operator: "", required: true, conforming: true },
    ]);
  });

  it("truncates the value to the prefix length before encoding", () => {
    expect(expandUriTemplate("x://a/{id:3}", { id: "abcdef" })).toBe(
      "x://a/abc",
    );
  });

  it("encodes what survives truncation", () => {
    expect(expandUriTemplate("x://a/{id:3}", { id: "a/bcdef" })).toBe(
      "x://a/a%2Fb",
    );
  });

  it("truncates by code point, never splitting an astral character", () => {
    // "\u{1F600}" is one code point but two UTF-16 units, so a naive
    // `slice(0, 1)` would emit a lone surrogate.
    expect(expandUriTemplate("x://{v:1}", { v: "\u{1F600}x" })).toBe(
      `x://${encodeURIComponent("\u{1F600}")}`,
    );
  });

  it("strips the explode modifier from the name", () => {
    expect(templateVariables("x://{id*}")[0].name).toBe("id");
  });
});

describe("the ; (path-parameter) operator", () => {
  // Absent from the SDK's operator list entirely: it parses `{;id}` as a
  // variable named ";id" and expands to "".
  it("is recognised as an operator, not part of the name", () => {
    expect(templateVariables("x://a{;id}")).toEqual([
      { name: "id", operator: ";", required: false, conforming: true },
    ]);
  });

  it("expands to a named path parameter", () => {
    expect(expandUriTemplate("x://a{;id}", { id: "7" })).toBe("x://a;id=7");
  });

  it("repeats its separator per pair", () => {
    expect(expandUriTemplate("x://a{;a,b}", { a: "1", b: "2" })).toBe(
      "x://a;a=1;b=2",
    );
  });

  it("encodes the value", () => {
    expect(expandUriTemplate("x://a{;p}", { p: "x/y" })).toBe("x://a;p=x%2Fy");
  });

  it("omits cleanly when undefined", () => {
    expect(expandUriTemplate("x://a{;id}", {})).toBe("x://a");
  });
});

describe("requiredGroups / hasRequiredValues", () => {
  // A required *expression* is satisfied by any one of its names, because
  // RFC 6570 drops the undefined ones -- verified against the SDK:
  // `x://{a,b}` with only `a` expands to "x://only-a".
  it("accepts a multi-name expression with only one name filled", () => {
    const groups = requiredGroups("x://{a,b}");
    expect(groups).toEqual([["a", "b"]]);
    expect(hasRequiredValues(groups, { a: "only-a", b: "" })).toBe(true);
    expect(
      expandUriTemplate("x://{a,b}", definedValues({ a: "only-a", b: "" })),
    ).toBe("x://only-a");
  });

  it("rejects a multi-name expression with nothing filled", () => {
    expect(
      hasRequiredValues(requiredGroups("x://{a,b}"), { a: "", b: "" }),
    ).toBe(false);
  });

  it("still requires a lone required variable", () => {
    const groups = requiredGroups("file:///users/{userId}/profile");
    expect(hasRequiredValues(groups, { userId: "" })).toBe(false);
    expect(hasRequiredValues(groups, { userId: "alice" })).toBe(true);
  });

  it("never blocks on an omittable expression", () => {
    expect(requiredGroups("foobar://events{?topic}")).toEqual([]);
    expect(
      hasRequiredValues(requiredGroups("foobar://events{?topic}"), {
        topic: "",
      }),
    ).toBe(true);
  });

  it("is satisfied by a template with no variables at all", () => {
    expect(hasRequiredValues(requiredGroups("file:///static.txt"), {})).toBe(
      true,
    );
  });

  it("tracks a name that recurs under a different operator", () => {
    // A per-variable model keeping only the first occurrence's group would
    // mark both names required with singleton groups and refuse this input;
    // the SDK expands the same template with just `a` to "x?a=11".
    const groups = requiredGroups("x{?a}{?b}{a,b}");
    expect(groups).toEqual([["a", "b"]]);
    expect(hasRequiredValues(groups, { a: "1", b: "" })).toBe(true);
    expect(expandUriTemplate("x{?a}{?b}{a,b}", { a: "1" })).toBe("x?a=11");
  });

  it("satisfies two required expressions sharing a name, from the others", () => {
    // `{a,b}{a,c}`: filling only b and c satisfies both groups. No
    // per-variable flag can express this, which is why groups are separate.
    const groups = requiredGroups("x://{a,b}{a,c}");
    expect(groups).toEqual([
      ["a", "b"],
      ["a", "c"],
    ]);
    expect(hasRequiredValues(groups, { b: "B", c: "C" })).toBe(true);
    expect(hasRequiredValues(groups, { b: "B" })).toBe(false);
  });
});

describe("a name repeated inside one expression", () => {
  // `{a,a}` is one requirement named twice, not two names either of which
  // would do. Undeduplicated it read as a shared group everywhere downstream:
  // the TUI's `length === 1` test marked `a` optional while its submit guard
  // still refused a blank, and the web panel offered "Any one of: a, a".
  it("collapses to a single-name required group", () => {
    expect(requiredGroups("x://{a,a}")).toEqual([["a"]]);
  });

  it("still expands both occurrences, which RFC 6570 requires", () => {
    expect(expandUriTemplate("x://{a,a}", { a: "1" })).toBe("x://1,1");
  });

  it("leaves genuinely distinct names alone", () => {
    expect(requiredGroups("x://{a,b}")).toEqual([["a", "b"]]);
  });
});

describe("expression independence", () => {
  it("does not rewrite a later query expression on the own-expansion path", () => {
    expect(
      expandUriTemplate("x://a{;k}{?one}{?two}", {
        k: "v",
        one: "1",
        two: "2",
      }),
    ).toBe("x://a;k=v?one=1?two=2");
  });

  it("omits an expression with no value without affecting its neighbours", () => {
    expect(
      expandUriTemplate("x://a{;k}{?one}{?two}", { k: "v", two: "2" }),
    ).toBe("x://a;k=v?two=2");
  });
});

describe("allow-reserved encoding under + and #", () => {
  // The SDK uses `encodeURI` for these operators, which corrupts two classes
  // of value rather than merely over-escaping: measured, encodeURI("[::1]")
  // is "%5B::1%5D" and encodeURI("%2F") is "%252F".
  it.each(["+", "#"])("leaves reserved [ and ] intact under %s", (operator) => {
    const prefix = operator === "#" ? "#" : "";
    expect(expandUriTemplate(`x://{${operator}v}`, { v: "[::1]" })).toBe(
      `x://${prefix}[::1]`,
    );
  });

  it.each(["+", "#"])(
    "does not double-encode an existing pct-triplet under %s",
    (operator) => {
      const prefix = operator === "#" ? "#" : "";
      expect(expandUriTemplate(`x://{${operator}v}`, { v: "a%2Fb" })).toBe(
        `x://${prefix}a%2Fb`,
      );
    },
  );

  it("still encodes a lone % that is not a triplet", () => {
    expect(expandUriTemplate("x://{+v}", { v: "100%" })).toBe("x://100%25");
  });

  it("still encodes characters outside the allowed set", () => {
    expect(expandUriTemplate("x://{+v}", { v: "a b" })).toBe("x://a%20b");
  });

  it("encodes an astral character whole rather than as surrogates", () => {
    expect(expandUriTemplate("x://{+v}", { v: "\u{1F600}" })).toBe(
      `x://${encodeURIComponent("\u{1F600}")}`,
    );
  });

  it("applies the same encoding in a multi-name + expression", () => {
    expect(expandUriTemplate("x://{+a,b}", { a: "[::1]", b: "%2F" })).toBe(
      "x://[::1],%2F",
    );
  });

  it("still percent-encodes reserved characters under the simple operator", () => {
    // Only + and # allow reserved through; the default path is unchanged.
    expect(expandUriTemplate("x://{v}", { v: "[::1]" })).toBe(
      "x://%5B%3A%3A1%5D",
    );
  });
});

describe("unreserved encoding under the non-reserved operators", () => {
  // `encodeURIComponent` leaves the sub-delims !'()* bare, but RFC 6570 only
  // allows *unreserved* characters through for these operators.
  it.each([
    ["", "x://"],
    [".", "x://a."],
    ["/", "x://a/"],
  ])("encodes !'()* under the %s operator", (operator, prefix) => {
    const base = operator === "" ? "x://" : "x://a";
    expect(
      expandUriTemplate(`${base}{${operator}v}`, { v: "a!b'c(d)e*f" }),
    ).toBe(`${prefix}a%21b%27c%28d%29e%2Af`);
  });

  it("encodes them in a named (query) expression too", () => {
    expect(expandUriTemplate("x://a{?v}", { v: "a!b" })).toBe("x://a?v=a%21b");
  });

  it("encodes them in a matrix expression too", () => {
    expect(expandUriTemplate("x://a{;v}", { v: "a!b" })).toBe("x://a;v=a%21b");
  });

  it("leaves them alone under + and #, where reserved characters are allowed", () => {
    expect(expandUriTemplate("x://{+v}", { v: "a!b'c(d)e*f" })).toBe(
      "x://a!b'c(d)e*f",
    );
  });

  it("still leaves the unreserved set itself untouched", () => {
    expect(expandUriTemplate("x://{v}", { v: "aZ0-._~" })).toBe("x://aZ0-._~");
  });
});

describe("prefix-modifier grammar", () => {
  // RFC 6570: max-length = %x31-39 0*3DIGIT -- 1..9999, no leading zero.
  // The SDK's constructor accepts these shapes, so nothing else rejects them;
  // treating `{id:abc}` as a plain `{id}` would send a URI the server never
  // advertised, with nothing to alert anyone.
  it.each(["x://{id:}", "x://{id:0}", "x://{id:abc}", "x://{id:10000}"])(
    "strict rejects the invalid template %s",
    (template) => {
      expect(() => expandUriTemplateStrict(template, { id: "abcdef" })).toThrow(
        /Invalid RFC 6570 varspec/,
      );
    },
  );

  it.each(["x://{id:}", "x://{id:abc}"])(
    "lenient returns %s unchanged rather than guessing",
    (template) => {
      expect(expandUriTemplate(template, { id: "abcdef" })).toBe(template);
    },
  );

  it.each([
    ["x://{id:1}", "a"],
    ["x://{id:9999}", "abcdef"],
  ])("accepts the in-range modifier %s", (template, expected) => {
    expect(expandUriTemplate(template, { id: "abcdef" })).toBe(
      `x://${expected}`,
    );
  });
});

describe("variable names that collide with Object.prototype", () => {
  // `toString`, `constructor`, `valueOf` and `__proto__` are all valid RFC 6570
  // varnames. A bare `values[name]` lookup finds the prototype's member for
  // every one of them, so a *blank* field read as supplied: measured,
  // `({})["toString"] !== undefined` is true and its typeof is "function".
  it.each(["toString", "constructor", "valueOf", "hasOwnProperty"])(
    "reads a blank {?%s} as its own empty value, not a prototype member",
    (name) => {
      // The own value is "", so the expression expands to a valueless pair --
      // NOT the inherited function's body, which is what a bare lookup gave.
      expect(expandUriTemplate(`x://a{?${name}}`, { [name]: "" })).toBe(
        `x://a?${name}=`,
      );
      // And with the key absent, the expression is omitted entirely.
      expect(expandUriTemplate(`x://a{?${name}}`, {})).toBe("x://a");
    },
  );

  it("omits the expression when the key is absent entirely", () => {
    expect(expandUriTemplate("x://a{?toString}", {})).toBe("x://a");
  });

  it("still expands such a variable when it really has a value", () => {
    expect(expandUriTemplate("x://a{?toString}", { toString: "v" })).toBe(
      "x://a?toString=v",
    );
  });

  it("does not treat an inherited member as satisfying a required group", () => {
    // `Object` (the inherited constructor) has length 1, so the old
    // `(values[name] ?? "").length > 0` test reported this as satisfied.
    expect(hasRequiredValues([["constructor"]], {})).toBe(false);
    expect(hasRequiredValues([["constructor"]], { constructor: "c" })).toBe(
      true,
    );
  });

  it("handles __proto__ as an ordinary variable name", () => {
    expect(expandUriTemplate("x://a{?__proto__}", {})).toBe("x://a");
  });
});

describe("an expression that declares no variable", () => {
  // RFC 6570 requires at least one varspec per expression and admits no empty
  // member, so each of these is a malformed template rather than one with a
  // member to skip. Skipping is the dangerous reading: `x://{}` would expand to
  // `x://` while the form rendered no inputs, so its "everything required is
  // filled" check is vacuously true and it submits a URI that is not the
  // template the server published.
  it.each([
    ["an empty expression", "x://{}"],
    ["only a separator", "x://{,}"],
    ["a missing member", "x://{a,}"],
    ["an operator and no name", "x://a{?}"],
    // `*` is an explode modifier, not a name -- it is stripped before the
    // emptiness test, so this must be rejected the same way.
    ["only an explode modifier", "x://{*}"],
  ])("strict rejects %s", (_label, template) => {
    expect(() => expandUriTemplateStrict(template, { a: "1" })).toThrow(
      /Invalid RFC 6570 varspec/,
    );
  });

  it("declares no required group for it, so only the expansion gate reports it", () => {
    // An empty group could never be satisfied, and the form's "any one of"
    // message built from it would name no fields -- the accurate reason is the
    // malformed template, which tryExpandUriTemplate gives.
    expect(requiredGroups("x://{}")).toEqual([]);
    expect(tryExpandUriTemplate("x://{}", {}).error).toMatch(
      /Invalid RFC 6570 varspec/,
    );
  });

  it("still reports the names a partly-empty expression does declare", () => {
    expect(templateVariables("x://{a,}").map((v) => v.name)).toEqual(["a"]);
  });

  it("leaves the template unexpanded on the display path", () => {
    expect(expandUriTemplate("x://{}", {})).toBe("x://{}");
  });
});

describe("varspec grammar", () => {
  // Each of these expanded rather than being refused before the anchored
  // grammar landed -- measured on the previous commit: `{*id}` and `{ id }`
  // both yielded "x://abcdef", and `{id*:3}` silently truncated to "x://abc"
  // through a modifier combination RFC 6570 does not allow.
  it.each([
    ["explode in the leading position", "x://{*id}"],
    ["explode combined with a prefix", "x://{id*:3}"],
    ["whitespace around the name", "x://{ id }"],
    ["whitespace inside the name", "x://{a b}"],
    ["a name outside the character set", "x://{a/b}"],
  ])("strict rejects %s", (_label, template) => {
    expect(() =>
      expandUriTemplateStrict(template, {
        id: "abcdef",
        a: "1",
        "a/b": "1",
        "a b": "1",
      }),
    ).toThrow(/Invalid RFC 6570 varspec/);
  });

  it.each([
    // RFC 6570 varchar, plus the two RFC 3986 unreserved characters the set is
    // deliberately widened by -- a name is emitted verbatim by `?`/`&`/`;`, so
    // the rule is "needs no encoding", and `{user-id}` is common in the wild.
    ["a plain name", "x://{id}", { id: "7" }, "x://7"],
    ["a hyphen", "x://{user-id}", { "user-id": "7" }, "x://7"],
    ["a tilde", "x://{a~b}", { "a~b": "7" }, "x://7"],
    ["an underscore", "x://{a_b}", { a_b: "7" }, "x://7"],
    ["a dot separator", "x://{a.b}", { "a.b": "7" }, "x://7"],
    ["a pct-encoded varchar", "x://{a%2Fb}", { "a%2Fb": "7" }, "x://7"],
    ["a trailing explode", "x://{id*}", { id: "7" }, "x://7"],
    ["a trailing prefix", "x://{id:3}", { id: "abcdef" }, "x://abc"],
  ])("accepts %s", (_label, template, values, expected) => {
    expect(expandUriTemplate(template, values)).toBe(expected);
  });

  it.each(["x://{a.}", "x://{a..b}"])(
    "rejects the misplaced dot in %s",
    (template) => {
      // varname = varchar *( ["."] varchar ) -- a dot separates, it cannot
      // trail or double.
      expect(() => expandUriTemplateStrict(template, {})).toThrow(
        /Invalid RFC 6570 varspec/,
      );
    },
  );

  it("reads a leading dot as the label operator, not a malformed name", () => {
    // `{.a}` is label expansion of `a` -- the one "misplaced dot" that is not
    // one, since the operator is stripped before the varspec is parsed.
    expect(expandUriTemplate("x://a{.ext}", { ext: "json" })).toBe(
      "x://a.json",
    );
  });
});

describe("unmetRequiredGroups", () => {
  it("names the groups that are missing", () => {
    expect(unmetRequiredGroups([["a", "b"], ["c"]], { c: "1" })).toEqual([
      ["a", "b"],
    ]);
  });

  it("agrees with hasRequiredValues on a prototype-collision name", () => {
    // The TUI derived its "Missing required template variable(s)" list with its
    // own bare `values[name]` filter: `({})["constructor"]` is `Object`, whose
    // `.length` is 1, so the group read as satisfied and the message named no
    // field while the gate still blocked the submit.
    const groups = [["constructor"]];
    expect(hasRequiredValues(groups, {})).toBe(false);
    expect(unmetRequiredGroups(groups, {})).toEqual([["constructor"]]);
  });
});

describe("literal normalization", () => {
  // RFC 6570 3.1: a literal may contain non-ASCII, but expansion emits it
  // pct-encoded -- the conformance case `café/{var}` expands to
  // `caf%C3%A9/value`. Literals used to pass through verbatim, and since this
  // module replaced the SDK's expander for both clients, nothing else was
  // going to encode them. (Measured: the pinned SDK returns `café/value` too.)
  it("percent-encodes a non-ASCII literal", () => {
    expect(expandUriTemplate("café/{var}", { var: "value" })).toBe(
      "caf%C3%A9/value",
    );
  });

  it("encodes a space in a literal", () => {
    expect(expandUriTemplate("a b/{v}", { v: "x" })).toBe("a%20b/x");
  });

  it.each([
    ["URI delimiters", "x://a/b?c=d#e{?q}", { q: "1" }, "x://a/b?c=d#e?q=1"],
    ["an existing pct-triplet", "a%20b/{v}", { v: "x" }, "a%20b/x"],
  ])("preserves %s", (_label, template, values, expected) => {
    expect(expandUriTemplate(template, values)).toBe(expected);
  });

  it("passes a brace through, so a malformed template stays legible", () => {
    // A brace reaches a literal only from a malformed template (an unclosed
    // `{` becomes trailing text). Encoding it to %7B would leave a string
    // resembling neither the template nor anything the server could match.
    expect(expandUriTemplate("x://a/{oops", { oops: "v" })).toBe("x://a/{oops");
  });
});

describe("names outside RFC 6570 varchar", () => {
  // The conformance suite rejects `{~thing}` and `{default-graph-uri}`. The
  // Inspector expands them anyway -- real servers publish hyphenated names and
  // the SDK's matcher round-trips them -- but the tolerance is labelled rather
  // than folded into the grammar, so a caller wanting RFC-exact behavior can
  // refuse on the flag.
  it.each(["user-id", "a~b"])("expands the tolerated name %s", (name) => {
    expect(expandUriTemplate(`x://{${name}}`, { [name]: "7" })).toBe("x://7");
  });

  it.each([
    ["default-graph-uri", false],
    ["~thing", false],
    ["plain_name", true],
    ["a.b", true],
    ["%61%62", true],
  ])("marks %s conforming=%s", (name, conforming) => {
    expect(templateVariables(`x://{${name}}`)[0].conforming).toBe(conforming);
  });

  it("marks a name non-conforming if any occurrence needed the tolerance", () => {
    expect(templateVariables("x://{user-id}{?user-id}")[0].conforming).toBe(
      false,
    );
  });
});

describe("prefix modifier truncation", () => {
  // RFC 6570 2.4.1 counts characters, and says a pct-encoded triplet counts as
  // ONE. Truncating by code point cut the sixth triplet in half -- measured
  // before the fix, `{+v:5}` over "%61%62%63%64%65%66" produced "x%61%256",
  // because the orphaned "%6" was no longer a triplet and its `%` was then
  // (correctly) encoded. A byte the caller never asked for.
  it.each([
    ["+", "x{+v:5}", "x%61%62%63%64%65"],
    ["#", "x{#v:5}", "x#%61%62%63%64%65"],
  ])("keeps pct-triplets whole under %s", (_op, template, expected) => {
    expect(expandUriTemplate(template, { v: "%61%62%63%64%65%66" })).toBe(
      expected,
    );
  });

  it.each([
    // The counting rule is operator-INDEPENDENT: a triplet is one character
    // wherever it appears. An earlier revision grouped only under `+`/`#`,
    // which made the same input mean two things and truncated `{v:1}` to a `%`
    // that was never a character of the value (it emitted "%25").
    ["x/{v:1}", "x/%2561"],
    ["x/{v:2}", "x/%2561%2562"],
    ["x/{v:3}", "x/%2561%2562"],
  ])(
    "counts a triplet as one character under a simple expansion (%s)",
    (template, expected) => {
      // What the operator decides is the *encoding* afterwards -- a simple
      // expansion still escapes the retained triplet's `%`, so `%61` -> `%2561`.
      expect(expandUriTemplate(template, { v: "%61%62" })).toBe(expected);
    },
  );

  it.each([
    // A pct-encoded UTF-8 sequence is ONE character: `%C3%A9` is `é`. Counting
    // per triplet returned `%C3`, a lone lead byte decoding to nothing.
    ["x{+v:1}", "%C3%A9x", "x%C3%A9"],
    ["x{+v:2}", "%C3%A9x", "x%C3%A9x"],
    // Three-octet (`€`) and four-octet (an emoji) sequences, same rule.
    ["x{+v:1}", "%E2%82%ACy", "x%E2%82%AC"],
    ["x{+v:1}", "%F0%9F%98%80z", "x%F0%9F%98%80"],
    // A malformed sequence -- a lead byte with too few continuations -- falls
    // back to per-triplet counting rather than swallowing what follows.
    ["x{+v:1}", "%C3x", "x%C3"],
    // A stray continuation byte is not a sequence start.
    ["x{+v:1}", "%A9%C3%A9", "x%A9"],
    // RFC 3629 well-formedness, not just the length-announcing lead byte: an
    // overlong encoding, a UTF-16 surrogate, and a code point past U+10FFFF
    // are each refused the grouping and counted per triplet.
    ["x{+v:1}", "%C0%80x", "x%C0"],
    ["x{+v:1}", "%E0%80%80x", "x%E0"],
    ["x{+v:1}", "%ED%A0%80x", "x%ED"],
    ["x{+v:1}", "%F4%90%80%80x", "x%F4"],
    // The boundary cases that ARE well-formed stay whole.
    ["x{+v:1}", "%E0%A0%80x", "x%E0%A0%80"],
    ["x{+v:1}", "%ED%9F%BFx", "x%ED%9F%BF"],
    ["x{+v:1}", "%F4%8F%BF%BFx", "x%F4%8F%BF%BF"],
  ])(
    "keeps a multi-octet sequence whole (%s over %s)",
    (template, value, expected) => {
      expect(expandUriTemplate(template, { v: value })).toBe(expected);
    },
  );

  it("counts a triplet as one character under a named operator too", () => {
    expect(expandUriTemplate("x{?v:1}", { v: "%61%62" })).toBe("x?v=%2561");
  });

  it("truncates by code point, not UTF-16 code unit", () => {
    // An astral character is one character; `slice` would cut the surrogate
    // pair in half and yield a lone surrogate.
    expect(
      expandUriTemplate("x/{v:2}", { v: "\u{1F600}\u{1F601}\u{1F602}" }),
    ).toBe("x/%F0%9F%98%80%F0%9F%98%81");
    expect(expandUriTemplate("x{+v:2}", { v: "\u{1F600}\u{1F601}" })).toBe(
      "x%F0%9F%98%80%F0%9F%98%81",
    );
  });

  it("leaves a value shorter than the prefix untouched", () => {
    expect(expandUriTemplate("x{+v:9}", { v: "%61%62" })).toBe("x%61%62");
  });
});

describe("a value defined as the empty string", () => {
  // RFC 6570 distinguishes an *undefined* variable (the expression is omitted)
  // from one defined as "". The expander used to collapse the two, which made
  // these URIs unrequestable through any caller -- `readResourceFromTemplate`
  // included. Dropping blanks is a *form* concern (a text input cannot express
  // "defined but empty"), so each client applies `definedValues` on its way in.
  it.each([
    ["a query expression keeps the =", "x{?q}", "x?q="],
    ["a continuation keeps the =", "x?a=1{&q}", "x?a=1&q="],
    // RFC 6570 3.2.7: the matrix operator drops the `=` for an empty value.
    ["the matrix operator drops the =", "x{;q}", "x;q"],
    ["a path segment expands to a bare separator", "x{/q}", "x/"],
    ["a label expands to a bare separator", "x{.q}", "x."],
    ["a simple expression contributes nothing visible", "x/{q}", "x/"],
  ])("%s", (_label, template, expected) => {
    expect(expandUriTemplate(template, { q: "" })).toBe(expected);
  });

  it("omits the expression only when the key is absent", () => {
    expect(expandUriTemplate("x{?q}", {})).toBe("x");
    expect(expandUriTemplate("x{;q}", {})).toBe("x");
  });

  it("keeps a defined-but-empty name alongside a filled one", () => {
    expect(expandUriTemplate("x{?a,b}", { a: "", b: "2" })).toBe("x?a=&b=2");
  });

  it("definedValues is what a form applies to drop its untouched fields", () => {
    expect(expandUriTemplate("x{?q}", definedValues({ q: "" }))).toBe("x");
  });
});

describe("unmatched braces", () => {
  // The SDK's constructor rejects an unclosed `{` but reads a stray `}` as
  // literal text, and this parser does the same -- so `x://a}` used to expand
  // to itself, a "URI" carrying a brace, with the panel enabling the read.
  it.each([
    ["a stray closing brace", "x://a}"],
    ["a closing brace after an expression", "x://{a}}"],
    ["an unclosed opening brace", "x://a/{oops"],
  ])("strict refuses %s", (_label, template) => {
    // The stray `}` is ours to catch; the unclosed `{` the SDK's constructor
    // already rejects ("Unclosed template expression"). Either way the read is
    // withheld, which is the property under test.
    expect(() => expandUriTemplateStrict(template, { a: "1" })).toThrow(
      /Unmatched brace|Unclosed template expression/,
    );
  });

  it("leaves such a template unexpanded on the display path", () => {
    expect(expandUriTemplate("x://a}", {})).toBe("x://a}");
    expect(expandUriTemplate("x://a/{oops", {})).toBe("x://a/{oops");
  });

  it("still accepts a well-formed expression", () => {
    expect(expandUriTemplate("x://{a}/b", { a: "1" })).toBe("x://1/b");
  });
});

describe("the per-value length ceiling", () => {
  // Replacing `UriTemplate.expand` dropped the SDK's own 1,000,000-character
  // guard, leaving the allocation-heavy encoders unbounded for a pasted or
  // programmatically supplied value.
  it("refuses a value past the limit", () => {
    const result = tryExpandUriTemplate("x://{v}", {
      v: "a".repeat(1_000_001),
    });
    expect(result.uri).toBeUndefined();
    expect(result.error).toMatch(/exceeds the 1000000-character limit/);
  });

  it("accepts a value at the limit", () => {
    const value = "a".repeat(1_000_000);
    expect(tryExpandUriTemplate("x://{v}", { v: value }).uri).toBe(
      `x://${value}`,
    );
  });

  it("ignores an oversized value the template never references", () => {
    // RFC 6570 ignores an extra variable, and the SDK path this replaced
    // validated a value only after looking one up by declared name -- so
    // checking the whole map refused `x://{id}` over a stale key beside it.
    expect(
      tryExpandUriTemplate("x://{id}", {
        id: "7",
        stale: "a".repeat(1_000_001),
      }).uri,
    ).toBe("x://7");
  });

  it("scopes valueLengthError to the names it is given", () => {
    const values = { id: "7", stale: "a".repeat(1_000_001) };
    expect(valueLengthError(values, ["id"])).toBeNull();
    expect(valueLengthError(values, ["id", "stale"])).not.toBeNull();
    // Unscoped, every entry is examined -- the behavior the preview and the
    // read both moved off.
    expect(valueLengthError(values)).not.toBeNull();
  });

  it("names the offending variable", () => {
    expect(
      tryExpandUriTemplate("x://{a}/{b}", { a: "1", b: "b".repeat(1_000_001) })
        .error,
    ).toMatch(/"b"/);
  });
});

describe("templateError", () => {
  it.each([
    ["a stray closing brace", "x://{a}}"],
    ["an unclosed brace", "x://{oops"],
    ["an invalid varspec", "x://{a,}"],
    ["an out-of-grammar modifier", "x://{id:abc}"],
  ])("reports %s", (_label, template) => {
    expect(templateError(template)).not.toBeNull();
  });

  it.each(["x://{a}", "x://a{?b,c}", "x://a{;d:3}", "café/{var}"])(
    "passes the valid template %s",
    (template) => {
      expect(templateError(template)).toBeNull();
    },
  );

  it("gives strict expansion its verdict, so the two cannot disagree", () => {
    // Every template the error reports must also refuse to expand.
    for (const template of ["x://{a}}", "x://{oops", "x://{a,}"]) {
      expect(templateError(template)).not.toBeNull();
      expect(() => expandUriTemplateStrict(template, { a: "1" })).toThrow();
    }
  });
});

describe("valueLengthError", () => {
  it("names the first oversized value", () => {
    expect(valueLengthError({ a: "1", b: "b".repeat(1_000_001) })).toMatch(
      /"b" exceeds the 1000000-character limit/,
    );
  });

  it("passes values at or under the limit", () => {
    expect(valueLengthError({ a: "a".repeat(1_000_000) })).toBeNull();
  });
});

describe("tryExpandUriTemplate", () => {
  it("returns the URI and no error when the template expands", () => {
    expect(
      tryExpandUriTemplate("foobar://events/{topic}", { topic: "foo/bar" }),
    ).toEqual({ uri: "foobar://events/foo%2Fbar" });
  });

  it("returns the reason instead of a URI for a malformed template", () => {
    const result = tryExpandUriTemplate("x://{id:abc}", { id: "7" });
    expect(result.uri).toBeUndefined();
    expect(result.error).toMatch(/Invalid RFC 6570 varspec/);
  });

  it("reports a value that cannot be encoded rather than throwing", () => {
    // A lone surrogate has no UTF-8 encoding, so encodeURIComponent throws
    // URIError on it -- and a text input can hold one via paste.
    const result = tryExpandUriTemplate("x://{v}", { v: "\ud800" });
    expect(result.uri).toBeUndefined();
    expect(result.error).toBeTruthy();
  });
});
