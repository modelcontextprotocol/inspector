import { describe, it, expect, vi, afterEach } from "vitest";
import {
  expandTemplate,
  previewTemplate,
  templateVariableNames,
} from "./uriTemplate";

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

  it("omits a variable with no value rather than emitting a dangling key", () => {
    expect(expandTemplate("foobar://events{?topic}", { topic: "" })).toBe(
      "foobar://events",
    );
  });

  it("omits a variable that is absent from the values entirely", () => {
    expect(expandTemplate("foobar://e{?a,b}", { a: "1" })).toBe(
      "foobar://e?a=1",
    );
  });

  it("returns the raw template when it cannot be parsed", () => {
    silenceWarn();
    expect(expandTemplate("x://{unterminated", { a: "1" })).toBe(
      "x://{unterminated",
    );
  });
});

describe("previewTemplate", () => {
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

  it("returns the raw template when it cannot be parsed", () => {
    silenceWarn();
    expect(previewTemplate("x://{unterminated", {})).toBe("x://{unterminated");
  });
});
