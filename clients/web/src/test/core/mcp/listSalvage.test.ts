import { describe, it, expect } from "vitest";
import { z } from "zod/v4";
import { SdkError, SdkErrorCode } from "@modelcontextprotocol/client";
import {
  LIST_MAX_PAGES,
  ModernResultEnvelopeSchema,
  describeIssues,
  listPaginationExceeded,
  isClientDecodeRejection,
  isSalvageableRejection,
  labelForRawItem,
  lenientListPageSchema,
  nextCursorOf,
  rawItemsOf,
  salvageListItems,
  summarizeMalformed,
} from "@inspector/core/mcp/listSalvage.js";
import { ListToolsResultSchema } from "@modelcontextprotocol/core";

/**
 * Per-item list salvage (#1909).
 *
 * These cover the pure half — deciding what is salvageable and how it is
 * described. The client-side half (fall back only on a decode rejection, keep
 * the strict path otherwise) is driven end to end against a real malformed
 * server in `src/test/integration/mcp/inspectorClient-malformed-list.test.ts`.
 */

const ItemSchema = z.object({
  name: z.string(),
  annotations: z.object({ priority: z.number().optional() }).optional(),
});

describe("isClientDecodeRejection", () => {
  it("is true for a result the client received and refused", () => {
    const err = new SdkError(SdkErrorCode.InvalidResult, "bad result");
    expect(isClientDecodeRejection(err)).toBe(true);
  });

  it("is true for a result type the codec cannot handle", () => {
    const err = new SdkError(SdkErrorCode.UnsupportedResultType, "unknown");
    expect(isClientDecodeRejection(err)).toBe(true);
  });

  it("is false for a failure that produced no result to salvage", () => {
    // A transport drop / timeout: re-listing would just fail again, and there
    // is no response frame to pick entries out of.
    expect(isClientDecodeRejection(new Error("socket hang up"))).toBe(false);
    expect(
      isClientDecodeRejection(
        new SdkError(SdkErrorCode.RequestTimeout, "timed out"),
      ),
    ).toBe(false);
  });
});

describe("lenientListPageSchema", () => {
  const ToolsPageSchema = lenientListPageSchema(ListToolsResultSchema, "tools");

  it("leaves the entries raw while still validating every other field", () => {
    // The entries are this module's job to check one at a time; everything
    // else is the real schema's, so a second violation can't ride along.
    const parsed = ToolsPageSchema.parse({
      tools: [{ name: "ok" }, { name: 42 }],
      nextCursor: "page-2",
    });
    expect(nextCursorOf(parsed)).toBe("page-2");
    expect(rawItemsOf(parsed, "tools")).toHaveLength(2);
  });

  it("rejects a page whose cursor is malformed", () => {
    // The walk itself depends on `nextCursor`, so a bad one is not salvageable
    // — the strict error should stand rather than a partial list being kept.
    expect(
      ToolsPageSchema.safeParse({ tools: [], nextCursor: 7 }).success,
    ).toBe(false);
  });

  it("rejects a top-level violation that rides along with a bad entry", () => {
    // A hand-rolled `{ nextCursor? }` schema would accept this, report the bad
    // entry, and silently drop the `_meta` violation with the strict error.
    expect(
      ToolsPageSchema.safeParse({ tools: [{ name: 42 }], _meta: "nope" })
        .success,
    ).toBe(false);
  });

  it("distinguishes an empty page from one that is not a list at all", () => {
    expect(rawItemsOf(ToolsPageSchema.parse({ tools: [] }), "tools")).toEqual(
      [],
    );
    expect(rawItemsOf({}, "tools")).toBeUndefined();
    expect(rawItemsOf({ tools: "not-a-list" }, "tools")).toBeUndefined();
    expect(rawItemsOf(null, "tools")).toBeUndefined();
  });

  it("reads no cursor from a non-object page", () => {
    expect(nextCursorOf(null)).toBeUndefined();
    expect(nextCursorOf({ nextCursor: 7 })).toBeUndefined();
  });
});

describe("isSalvageableRejection", () => {
  it("salvages an invalid result but not an unrecognized result type", () => {
    // `UnsupportedResultType` means the codec doesn't know what KIND of frame
    // arrived — not a list with a bad entry, so there is nothing to salvage
    // and reporting an item-level reason would hide the real failure.
    expect(
      isSalvageableRejection(new SdkError(SdkErrorCode.InvalidResult, "bad")),
    ).toBe(true);
    expect(
      isSalvageableRejection(
        new SdkError(SdkErrorCode.UnsupportedResultType, "unknown"),
      ),
    ).toBe(false);
    // Still marks the Protocol entry, which is why both predicates exist.
    expect(
      isClientDecodeRejection(
        new SdkError(SdkErrorCode.UnsupportedResultType, "unknown"),
      ),
    ).toBe(true);
  });
});

describe("ModernResultEnvelopeSchema", () => {
  it("accepts a complete modern result with its cache hints", () => {
    expect(
      ModernResultEnvelopeSchema.safeParse({
        resultType: "complete",
        ttlMs: 0,
        cacheScope: "public",
        tools: [],
      }).success,
    ).toBe(true);
  });

  it("requires ttlMs to be a non-negative integer, as the codec does", () => {
    // A looser `z.number()` would accept `-1` / `0.5`, so a response with a bad
    // envelope AND one bad entry would salvage and hide the envelope violation.
    for (const ttlMs of [-1, 0.5]) {
      expect(
        ModernResultEnvelopeSchema.safeParse({
          resultType: "complete",
          ttlMs,
          cacheScope: "public",
        }).success,
      ).toBe(false);
    }
  });

  it("rejects a modern result missing the envelope the codec would enforce", () => {
    // The raw-wire salvage path goes around that codec, so a response missing
    // its cache hints AND carrying a bad entry must not salvage.
    expect(
      ModernResultEnvelopeSchema.safeParse({
        resultType: "complete",
        tools: [],
      }).success,
    ).toBe(false);
    expect(
      ModernResultEnvelopeSchema.safeParse({
        resultType: "task",
        ttlMs: 0,
        cacheScope: "public",
      }).success,
    ).toBe(false);
  });
});

describe("labelForRawItem", () => {
  it("prefers a name, then a uriTemplate, uri, or title", () => {
    expect(labelForRawItem({ name: "get_weather" })).toBe("get_weather");
    expect(labelForRawItem({ uriTemplate: "file:///{path}" })).toBe(
      "file:///{path}",
    );
    expect(labelForRawItem({ uri: "test://one" })).toBe("test://one");
    expect(labelForRawItem({ title: "Titled" })).toBe("Titled");
  });

  it("has no label for an entry too broken to carry one", () => {
    expect(labelForRawItem(null)).toBeUndefined();
    expect(labelForRawItem("just a string")).toBeUndefined();
    expect(labelForRawItem(7)).toBeUndefined();
    expect(labelForRawItem({ name: "" })).toBeUndefined();
    expect(labelForRawItem({ name: 42 })).toBeUndefined();
  });
});

describe("describeIssues", () => {
  it("names the offending field so the reader doesn't have to hunt", () => {
    const result = ItemSchema.safeParse({ name: "t", annotations: [] });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(describeIssues(result.error)).toMatch(
      /^annotations: .*expected object/i,
    );
  });

  it("names the expected type even when zod's message omits it", () => {
    // The browser build reports a bare "Invalid input" where Node spells out
    // "expected object, received array" — without the expected type the warning
    // says something is wrong but not what would be right.
    const terse = new z.ZodError([
      {
        code: "invalid_type",
        expected: "object",
        path: ["annotations"],
        message: "Invalid input",
        // Double cast: the terse-message shape is what zod's BROWSER build
        // emits, and no parse run under Node can produce it — the issue has to
        // be hand-built, and `$ZodIssue`'s union doesn't accept a literal.
      } as unknown as z.core.$ZodIssue,
    ]);
    expect(describeIssues(terse)).toBe(
      "annotations: Invalid input (expected object)",
    );
  });

  it("does not repeat an expected type the message already carries", () => {
    const result = ItemSchema.safeParse({ name: "t", annotations: [] });
    expect(result.success).toBe(false);
    if (result.success) return;
    const described = describeIssues(result.error);
    expect(described.match(/expected object/g)).toHaveLength(1);
  });

  it("omits the path when the failure is the entry itself", () => {
    const result = ItemSchema.safeParse("not an object");
    expect(result.success).toBe(false);
    if (result.success) return;
    const described = describeIssues(result.error);
    expect(described).not.toMatch(/^:/);
    expect(described).toMatch(/expected object/i);
  });
});

describe("salvageListItems", () => {
  it("keeps the valid entries and reports only the broken one", () => {
    const { valid, malformed } = salvageListItems({
      method: "resources/templates/list",
      items: [
        { name: "empty_annotations", annotations: {} },
        { name: "array_annotations", annotations: [] },
        { name: "full_annotations", annotations: { priority: 0.8 } },
      ],
      schema: ItemSchema,
    });

    expect(valid.map((item) => item.name)).toEqual([
      "empty_annotations",
      "full_annotations",
    ]);
    expect(malformed).toEqual([
      {
        method: "resources/templates/list",
        index: 1,
        label: "array_annotations",
        reason: expect.stringMatching(/^annotations: /),
      },
    ]);
  });

  it("reports an unlabelable entry by its position", () => {
    const { valid, malformed } = salvageListItems({
      method: "tools/list",
      items: [null],
      schema: ItemSchema,
    });
    expect(valid).toEqual([]);
    expect(malformed[0]).toMatchObject({ index: 0 });
    expect(malformed[0]).not.toHaveProperty("label");
  });

  it("indexes against the aggregated list, not the page", () => {
    // Page 2 of a paginated walk: an index that restarted per page would point
    // at the wrong entry in the list the user is looking at.
    const { malformed } = salvageListItems({
      method: "tools/list",
      items: [{ name: "ok" }, { name: 5 }],
      schema: ItemSchema,
      startIndex: 10,
    });
    expect(malformed[0]?.index).toBe(11);
  });

  it("salvages nothing from a wholly conforming page", () => {
    const { valid, malformed } = salvageListItems({
      method: "prompts/list",
      items: [{ name: "a" }, { name: "b" }],
      schema: ItemSchema,
    });
    expect(valid).toHaveLength(2);
    expect(malformed).toEqual([]);
  });
});

describe("summarizeMalformed", () => {
  it("names the single dropped entry and why", () => {
    expect(
      summarizeMalformed([
        {
          method: "resources/templates/list",
          index: 1,
          label: "array_annotations",
          reason: "annotations: expected object, received array",
        },
      ]),
    ).toBe(
      "Dropped 1 malformed entry — array_annotations: annotations: expected object, received array",
    );
  });

  it("counts the rest when several failed, falling back to the index", () => {
    const summary = summarizeMalformed([
      { method: "tools/list", index: 0, reason: "expected object" },
      { method: "tools/list", index: 3, reason: "expected object" },
    ]);
    expect(summary).toContain("Dropped 2 malformed entries");
    expect(summary).toContain("index 0");
    expect(summary).toContain("(+1 more)");
  });

  describe("the page bound", () => {
    it("matches the cap the SDK client is configured with", () => {
      // The value is passed to the SDK as `listMaxPages`, so the strict
      // aggregate and the fallback walks are bounded by the same number.
      expect(LIST_MAX_PAGES).toBe(64);
    });

    it("names the method and the cap it hit", () => {
      // The walk's failure is logged rather than surfaced (the original
      // validation error is what the caller sees), so the message is the only
      // record of why salvage gave up.
      const error = listPaginationExceeded("resources/templates/list");
      expect(error.message).toContain("resources/templates/list");
      expect(error.message).toContain("64 pages");
    });
  });
});
