/**
 * Per-item salvage for paginated list results (#1909).
 *
 * The SDK validates a list result as a whole: one non-conforming element
 * rejects the entire response, so a server with a single malformed entry
 * appears to have NO tools/resources/templates/prompts at all. That is exactly
 * backwards for a debugging tool — the one thing the user needs to see is which
 * entry is wrong and why, and the other entries are still perfectly usable.
 *
 * A real report: a PHP server whose empty `annotations` object reaches the wire
 * as `[]` (`json_encode` of an empty array, or of `(array) new stdClass()`)
 * instead of `{}` made every resource template vanish behind "Couldn't load
 * resources" (#1909).
 *
 * The strict path is left alone. `InspectorClient.listAll*` still calls the
 * SDK's cache-aware aggregate first, and only falls back to a lenient re-walk
 * when that rejects a result it received — so a conforming server pays nothing,
 * and the fallback is a pure recovery path.
 *
 * Salvaging does NOT mean accepting: a salvaged entry is dropped from the list
 * and reported as {@link MalformedListItem}, and the Protocol entry is still
 * marked rejected. The Inspector keeps telling the truth about the response; it
 * just stops throwing away the valid part of it.
 */

import { z } from "zod/v4";
import { SdkError, SdkErrorCode } from "@modelcontextprotocol/client";
import { ToolSchema } from "@modelcontextprotocol/core";
import type { Tool } from "@modelcontextprotocol/client";

/**
 * One entry the Inspector dropped from a list result because it failed the
 * spec's schema for that primitive.
 */
export interface MalformedListItem {
  /** The list method that carried it, e.g. `"resources/templates/list"`. */
  method: string;
  /**
   * Zero-based position in the aggregated list. An entry too broken to carry a
   * name is still identifiable by where it sat in the response.
   */
  index: number;
  /** Best-effort label read off the raw entry, when it has a usable one. */
  label?: string;
  /** Why it was rejected — the first validation issue, with its field path. */
  reason: string;
}

/**
 * Hard cap on the pages a salvage / scan re-walk will fetch.
 *
 * The SDK's auto-aggregating `list*()` is capped by
 * `ClientOptions.listMaxPages` and THROWS when it is hit, so a partial
 * aggregate is never presented as a complete one. The fallback walks in this
 * module go around that aggregate, so without their own bound a server whose
 * `nextCursor` never converges — but never repeats, so the non-converging guard
 * never fires — would keep the walk issuing requests and accumulating entries
 * forever. That is reachable from any server the user points the Inspector at,
 * which is the whole population here.
 *
 * The value is passed to the SDK client as `listMaxPages` (see
 * `InspectorClient`'s constructor) rather than merely matching its default, so
 * the strict path and the fallback are bounded by the SAME number by
 * construction and cannot drift if the SDK changes its default.
 */
export const LIST_MAX_PAGES = 64;

/**
 * The error a walk raises when it hits {@link LIST_MAX_PAGES}.
 *
 * Both callers turn this into "the strict error stands": hitting the cap means
 * there are more entries we did not fetch, so returning what we have would
 * present a TRUNCATED list as a complete one — the same silent-truncation
 * failure {@link rawItemsOf} refuses for a non-array page. That is why this
 * aborts rather than `break`ing like the repeated-cursor guard, which stops on
 * a page whose entries were all seen already and so loses nothing.
 */
export function listPaginationExceeded(method: string): Error {
  return new Error(
    `Salvage walk for ${method} exceeded ${LIST_MAX_PAGES} pages without the server's pagination converging`,
  );
}

/**
 * Whether a failed fetch is the CLIENT refusing a response it received, rather
 * than the request never producing one.
 *
 * This gates both `markResponseRejected` (#1953) and the salvage fallback
 * (#1909), and the distinction is load-bearing for each. For the Protocol-entry
 * marking: the correlation recovers the request id as "the last response
 * received for this method", which is only the failing exchange when a response
 * actually just arrived and was refused while decoding. A transport drop, a
 * timeout, or an aborted request produces no response frame at all — the
 * last-answered id then still points at some EARLIER, successful call, and
 * marking it would stamp "Rejected by the Inspector" onto an exchange that
 * succeeded. For the salvage fallback: re-walking the list only makes sense
 * when there IS a result to salvage; re-issuing the request after a timeout
 * would just double the wait before failing anyway.
 *
 * A server-sent JSON-RPC error is excluded for a different reason: it is a real
 * response, so the id would be right, but the failure is the server's. Its
 * entry already renders as an error from the error frame itself, and blaming
 * the Inspector for it would misattribute the cause.
 *
 * `SdkErrorCode.InvalidResult` is exactly "a result arrived and failed
 * validation for the negotiated era"; `UnsupportedResultType` is its sibling
 * for a `resultType` the codec has no handling for. Both are decisions the
 * client made about a frame in hand.
 */
export function isClientDecodeRejection(err: unknown): boolean {
  return (
    SdkError.isInstance(err) &&
    (err.code === SdkErrorCode.InvalidResult ||
      err.code === SdkErrorCode.UnsupportedResultType)
  );
}

/**
 * Whether a decode rejection is one the per-item fallback may attempt at all.
 *
 * Narrower than {@link isClientDecodeRejection} on purpose, and the difference
 * is the point: `UnsupportedResultType` says the codec does not recognize what
 * KIND of frame arrived, so it is not a list result with a bad entry in it —
 * it is not a list result at all. Salvaging it would report an item-level
 * reason for a protocol-level failure and hide the real one. Marking the
 * Protocol entry rejected still applies to both, which is why the broader
 * predicate stays.
 */
export function isSalvageableRejection(err: unknown): boolean {
  return SdkError.isInstance(err) && err.code === SdkErrorCode.InvalidResult;
}

/**
 * The page schema for a salvage re-walk: the method's REAL result schema with
 * only its item array relaxed to `unknown[]`.
 *
 * Deriving it from the spec schema rather than hand-rolling a permissive object
 * is what keeps the fallback honest. A hand-rolled `{ nextCursor? }` validates
 * pagination and nothing else, so a response carrying a malformed item AND an
 * unrelated top-level violation would be accepted, the item reported, and the
 * other violation silently dropped along with the strict error that caught it.
 * Extending the real schema means every top-level field — `_meta`, `nextCursor`,
 * anything a future revision adds — is still validated; only the entries, which
 * this whole module exists to check one at a time, are left raw.
 */
export function lenientListPageSchema(
  resultSchema: z.ZodObject,
  itemsKey: string,
): z.ZodObject {
  return resultSchema.extend({ [itemsKey]: z.array(z.unknown()) });
}

/**
 * Read the pagination cursor off a leniently-parsed page.
 *
 * The page is typed as a plain object because `extend()` on a runtime-selected
 * key loses the shape, so the fields are read through narrowing helpers rather
 * than asserted with a cast. The schema has already validated that a present
 * `nextCursor` is a string; this narrows the static type to match.
 */
export function nextCursorOf(page: unknown): string | undefined {
  if (typeof page !== "object" || page === null) return undefined;
  const value = (page as Record<string, unknown>).nextCursor;
  return typeof value === "string" ? value : undefined;
}

/**
 * The era envelope a modern (2026-07-28) result must carry, checked separately
 * because it lives in the SDK's codec rather than in the spec result schema —
 * and the modern salvage path deliberately goes around that codec.
 *
 * Without this, a modern response that is missing its cache hints AND has one
 * bad entry would salvage: the entry gets reported and the envelope violation
 * disappears. A failure here means "not salvageable", so the strict error
 * stands — the safe direction if a future revision changes these rules, since
 * the strict path remains the authority on what is valid.
 */
export const ModernResultEnvelopeSchema = z.looseObject({
  resultType: z.literal("complete"),
  // A non-negative INTEGER, matching the codec: `ttlMs: -1` or `0.5` is an
  // envelope violation the strict path rejects, and accepting it here on the
  // strength of an unrelated bad entry would hide it.
  ttlMs: z.int().min(0),
  cacheScope: z.enum(["public", "private"]),
});

/**
 * Read the primitive array out of a leniently-parsed page.
 *
 * Returns `undefined` — NOT an empty array — when the member is missing or is
 * not an array, because those are different facts. An empty page is a normal
 * server answer; a page whose `tools` is the string `"invalid"` is a top-level
 * schema violation this fallback cannot explain, and reading it as "no entries"
 * would let the caller return a silently truncated list while the strict error
 * that was correct about it is discarded.
 */
export function rawItemsOf(
  page: unknown,
  itemsKey: string,
): unknown[] | undefined {
  if (typeof page !== "object" || page === null) return undefined;
  const value = (page as Record<string, unknown>)[itemsKey];
  return Array.isArray(value) ? value : undefined;
}

/**
 * Best-effort human label for a raw entry: whichever identifying string field
 * it happens to carry. Undefined when the entry is too broken to have one (a
 * bare string, a number, a null) — the caller falls back to the index.
 */
export function labelForRawItem(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["name", "uriTemplate", "uri", "title"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return undefined;
}

/**
 * One-line summary of why an entry failed: the first issue, prefixed with its
 * field path so `annotations` is named rather than left for the reader to find
 * in a wall of JSON. The path is relative to the entry, not the response, since
 * the entry is what we're reporting on.
 */
export function describeIssues(error: z.ZodError): string {
  const [issue] = error.issues;
  /* v8 ignore next -- zod never produces a failed parse with zero issues; guards against an empty message if it ever did */
  if (!issue) return "did not match the expected shape";
  const path = issue.path.join(".");
  const detail = expectedDetail(issue);
  const message = detail ? `${issue.message} (${detail})` : issue.message;
  return path.length > 0 ? `${path}: ${message}` : message;
}

/**
 * `expected object` — appended because the issue's own message cannot be relied
 * on to carry it. zod's browser build reports a bare "Invalid input" where Node
 * says "Invalid input: expected object, received array", and the expected type
 * is the whole diagnostic: without it the warning says something is wrong but
 * not what would be right. Skipped when the message already spells it out, so
 * the Node text doesn't end up saying it twice.
 */
function expectedDetail(issue: z.core.$ZodIssue): string | undefined {
  if (!("expected" in issue) || typeof issue.expected !== "string") {
    return undefined;
  }
  const detail = `expected ${issue.expected}`;
  return issue.message.includes(detail) ? undefined : detail;
}

/**
 * Validate a page's entries one at a time, keeping the ones that pass.
 *
 * `startIndex` is the running count across pages, so an index in the report
 * refers to the aggregated list the user sees rather than resetting per page.
 */
export function salvageListItems<T>({
  method,
  items,
  schema,
  startIndex = 0,
}: {
  method: string;
  items: unknown[];
  schema: z.ZodType<T>;
  startIndex?: number;
}): { valid: T[]; malformed: MalformedListItem[] } {
  const valid: T[] = [];
  const malformed: MalformedListItem[] = [];
  items.forEach((item, offset) => {
    const parsed = schema.safeParse(item);
    if (parsed.success) {
      valid.push(parsed.data);
      return;
    }
    const label = labelForRawItem(item);
    malformed.push({
      method,
      index: startIndex + offset,
      ...(label !== undefined && { label }),
      reason: describeIssues(parsed.error),
    });
  });
  return { valid, malformed };
}

/**
 * Summary line used for the Protocol entry's rejection reason, so the Network /
 * Protocol view still says the response was non-conforming even though the list
 * rendered (#1953 + #1909).
 */
export function summarizeMalformed(malformed: MalformedListItem[]): string {
  const [first] = malformed;
  /* v8 ignore next -- callers only summarize a non-empty set */
  if (!first) return "";
  const where = first.label ?? `index ${first.index}`;
  const rest = malformed.length > 1 ? ` (+${malformed.length - 1} more)` : "";
  return `Dropped ${malformed.length} malformed ${
    malformed.length === 1 ? "entry" : "entries"
  } — ${where}: ${first.reason}${rest}`;
}

/**
 * The item contract for `tools/list` on a given era.
 *
 * The public `ToolSchema` is era-NEUTRAL, and each negotiated era's wire schema
 * differs from it — in BOTH directions, which is the thing to keep in mind
 * here. The obvious failure is a fallback that is more permissive than the
 * strict path, readmitting an entry the era refused. The equally real one is a
 * fallback that is more STRICT: it drops a tool the strict path would have
 * kept, and this module then reports it as malformed — accusing a conforming
 * server of an error it did not make, on a screen whose whole job is to say
 * which entry is wrong.
 *
 * Every rule below was measured against SDK 2.0.0 on a real connection rather
 * than read off the (unexported) era schemas, and each is pinned by
 * `listSalvage-era.test.ts` so a divergence that closes or widens fails loudly
 * instead of rotting:
 *
 * | case                        | 2025 (legacy) | 2026 (modern) |
 * | --------------------------- | ------------- | ------------- |
 * | `inputSchema.type: "array"` | reject        | reject        |
 * | `inputSchema.properties: 5` | reject        | **accept**    |
 * | `inputSchema.required: [1]` | reject        | **accept**    |
 * | `inputSchema.$schema: 5`    | **accept**    | reject        |
 * | `outputSchema.type: "array"`| reject        | **accept**    |
 * | `outputSchema.properties: 5`| reject        | **accept**    |
 * | `outputSchema.required: [1]`| reject        | **accept**    |
 * | `outputSchema.$schema: 5`   | **accept**    | reject        |
 * | `execution`                 | kept          | **stripped**  |
 *
 * Which reduces to two overrides on the neutral schema, one per era, plus the
 * modern `execution` strip — see {@link LegacyToolWireSchema} and
 * {@link ModernToolWireSchema}.
 *
 * Replicating rules that live in the SDK's internals is a real cost, taken
 * deliberately: the alternative is a fallback that quietly disagrees with the
 * path it stands in for, in whichever direction the neutral schema happens to
 * differ.
 */
export function toolItemSchemaForEra(isModern: boolean): z.ZodType<Tool> {
  return isModern
    ? eraToolItemSchema(ModernToolWireSchema, stripExecution)
    : eraToolItemSchema(LegacyToolWireSchema, (tool) => tool);
}

/**
 * The 2025 wire shape for a tool.
 *
 * The only divergence from the neutral schema is `outputSchema`, which the
 * legacy codec validates with the SAME shape it uses for `inputSchema` — a
 * required `type: "object"`, `properties` as a JSON record, `required` as
 * strings — where the neutral schema checks only `$schema`. Reusing
 * `ToolSchema.shape.inputSchema` states that relationship instead of
 * re-deriving it, so the two cannot drift apart by hand.
 */
const LegacyToolWireSchema = ToolSchema.extend({
  outputSchema: ToolSchema.shape.inputSchema.optional(),
});

/**
 * The 2026-07-28 wire shape for a tool.
 *
 * Its `inputSchema` is the mirror image of the legacy divergence: the modern
 * codec constrains only `type` and `$schema` and leaves the remaining JSON
 * Schema keywords open, where the neutral schema additionally validates
 * `properties` and `required`. `outputSchema` needs no override — the neutral
 * `$schema`-only check is already what the modern codec applies.
 */
const ModernToolWireSchema = ToolSchema.extend({
  inputSchema: z.looseObject({
    type: z.literal("object"),
    $schema: z.string().optional(),
  }),
});

/** `execution` is not part of the 2026 wire shape; drop it as the codec does. */
function stripExecution(tool: Tool): Tool {
  if (tool.execution === undefined) return tool;
  const { execution: _execution, ...rest } = tool;
  return rest;
}

/**
 * Bridge a per-era WIRE schema to the `Tool` the rest of the client works with.
 *
 * The bridge exists because the two cannot be the same schema: on BOTH eras the
 * wire shape accepts values the exported `Tool` type cannot describe —
 * `properties: 5` is a valid modern `inputSchema` keyword set, and the SDK
 * hands exactly that back typed as a `Tool`. So the era rules are expressed as
 * an ordinary schema, and its parsed output is asserted to `Tool` here.
 *
 * The parsed OUTPUT is what gets normalized and returned, not the raw input.
 * That matters: both era schemas are `z.object`, so parsing strips unknown
 * top-level fields (and unknown keys inside `annotations`) exactly as the
 * strict codec does. Validating with the wire schema but returning the original
 * value would leave salvaged tools carrying fields the strict path drops, so
 * the two paths would hand the UI differently-shaped tools for the same server.
 *
 * The assertion is single and deliberate — `parsed` is `unknown`, so this is
 * the narrow `as` the double-cast rule asks for rather than an `as unknown as`
 * — and it is the same claim the SDK makes about its own era-parsed results.
 * Issues come straight from the wire parse, so they keep their field paths and
 * `describeIssues` can still name `inputSchema.type` rather than reporting a
 * bare "Invalid input".
 */
function eraToolItemSchema(
  wire: z.ZodType,
  normalize: (tool: Tool) => Tool,
): z.ZodType<Tool> {
  return wire.transform((parsed) => normalize(parsed as Tool));
}
