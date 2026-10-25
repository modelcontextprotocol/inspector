/**
 * Skills extension wire schemas — SEP-2640 (`io.modelcontextprotocol/skills`).
 *
 * **The SDK owns the wire constants, and owns the schemas wherever the
 * Inspector can take them unchanged (#2804).** MCP TypeScript SDK 2.4.0 ships
 * the client side of this extension (`@modelcontextprotocol/client/ext/skills`)
 * and its schemas (`@modelcontextprotocol/core/ext/skills`). From the second
 * this module re-exports the method names, the extension id and the directory
 * mime type, and builds every caching attribute and the whole
 * `resources/directory/read` result out of the SDK's schemas rather than
 * restating them, so a spec revision lands with an SDK bump instead of a
 * hand edit here.
 *
 * **The entry schemas stay the Inspector's, and that is the one deliberate
 * divergence.** The SDK's `SkillSchema` is a *host's* schema: `digest` must
 * match the `sha256:` pattern, `size` must be a non-negative integer, and
 * `name` and `description` are required, so a non-conforming entry fails the
 * parse. `SkillsClient` then either throws on it or, with `skipInvalid`,
 * returns `{ index, uri, reason }` in place of the entry. An inspector has to
 * show that entry — its frontmatter, its manifest and one finding per broken
 * rule — so the schemas below parse it permissively and leave the verdict to
 * `checkSkillConformance`. Taking the SDK's schema here would turn every
 * finding the conformance report exists to show into a page that fails to
 * load. The same reason keeps `SkillsClient.list()` / `get()` out of the call
 * path: both run that schema over every entry.
 *
 * **Permissive where a defect should be reported; strict where a shape is
 * settled.** `looseObject`, and a `digest` typed as a plain string rather than
 * a hex-constrained one, so a non-conforming server is *surfaced* by
 * `checkSkillConformance` rather than rejected at the parse — a malformed
 * digest is a finding, not a parse error to swallow. But a settled shape is
 * enforced, because silently normalizing one past the checks would defeat the
 * point: `skills/get` requires its `{ skill }` envelope, and a modern
 * `skills/list`, `skills/get` or `resources/directory/read` result requires
 * the caching attributes (see `ModernListSkillsResultSchema`,
 * `ModernGetSkillEnvelopeSchema` and `ModernDirectoryReadResultSchema`).
 *
 * The method names are consumer-owned as far as the SDK's era codecs are
 * concerned: `Protocol._assertOutboundRequestInEra` only fires for names one
 * of the codecs knows, so `skills/list` and `skills/get` go out unchanged on
 * both the 2025- and 2026-era legs as ordinary `client.request(…, Schema)`
 * calls. The raw-wire escape hatch modern `tasks/*` needs is deliberately NOT
 * used here — `tasks/*` are spec names the 2026 codec deleted, which is a
 * different problem.
 */

import { z } from "zod/v4";
import {
  ReadResourceDirectoryResultSchema,
  SkillCacheScopeSchema,
} from "@modelcontextprotocol/core/ext/skills";

/**
 * SEP-2133 extension identifier, the three method names and the directory
 * mime type, re-exported from the SDK rather than restated so each string has
 * one owner — the same shape `core/extension/tasks/constants.ts` uses.
 * `RESOURCES_DIRECTORY_READ_METHOD` is gated on the server declaring
 * `directoryRead: true`.
 */
export {
  SKILLS_EXTENSION_ID as SKILLS_EXTENSION_KEY,
  SKILLS_LIST_METHOD,
  SKILLS_GET_METHOD,
  RESOURCES_DIRECTORY_READ_METHOD,
  DIRECTORY_MIME_TYPE,
} from "@modelcontextprotocol/core/ext/skills";

/**
 * `CacheableResult`'s two attributes, as the SDK states them: `ttlMs` a
 * non-negative integer, `cacheScope` `public` or `private`. Taken from the
 * SDK's own directory-read schema, the one result schema it exports that the
 * Inspector uses whole, so the caching fields on every era-aware schema here
 * are the SDK's and cannot drift from it.
 */
const CACHE_FIELDS = {
  ttlMs: ReadResourceDirectoryResultSchema.shape.ttlMs,
  cacheScope: SkillCacheScopeSchema,
};

/**
 * The literal `resources` value meaning "this skill's file set is generated and
 * cannot be enumerated". Integrity verification is impossible for such a skill,
 * which is why it is a reported finding rather than a silent absence.
 */
export const DYNAMIC_RESOURCES = "dynamic";

/**
 * The verbatim YAML frontmatter of a `SKILL.md`, expressed as JSON. `name` and
 * `description` are the two fields SEP-2640 requires; everything else the Agent
 * Skills format defines passes through untouched, since that format versions
 * independently of this extension.
 */
export const SkillFrontmatterSchema = z.looseObject({
  name: z.string().optional(),
  description: z.string().optional(),
});

export type SkillFrontmatter = z.infer<typeof SkillFrontmatterSchema>;

/**
 * One file in a skill's manifest. `digest` is `sha256:` + 64 lowercase hex per
 * the SEP, but it is typed as a bare string so a server that gets the format
 * wrong still parses and can be *reported* — see `checkSkillConformance`.
 */
export const SkillResourceSchema = z.looseObject({
  uri: z.string(),
  digest: z.string().optional(),
  size: z.number().optional(),
});

export type SkillResource = z.infer<typeof SkillResourceSchema>;

/**
 * A skill entry as returned by `skills/list` and `skills/get`. `resources` is
 * either the full file manifest or the literal `"dynamic"`; the union is
 * preserved on the type rather than normalized away, because which one a server
 * sent is itself the finding.
 */
export const SkillEntrySchema = z.looseObject({
  uri: z.string(),
  frontmatter: SkillFrontmatterSchema,
  resources: z.union([
    z.literal(DYNAMIC_RESOURCES),
    z.array(SkillResourceSchema),
  ]),
});

export type SkillEntry = z.infer<typeof SkillEntrySchema>;

/**
 * `skills/list` result on a **legacy** connection: a page of entries plus the
 * opaque cursor, and nothing required beyond that.
 */
export const ListSkillsResultSchema = z.looseObject({
  skills: z.array(SkillEntrySchema),
  nextCursor: z.string().optional(),
});

export type ListSkillsResult = z.infer<typeof ListSkillsResultSchema>;

/**
 * `skills/list` result on a **modern** (2026-07-28+) connection: the page plus
 * the base list envelope.
 *
 * SEP-2640's `skills/list` section states: *"In protocol versions 2026-07-28
 * and later, the result also carries … `ttlMs` and `cacheScope`."* The field
 * shapes are the SDK's own ({@link CACHE_FIELDS}), the same two `SkillsClient`
 * requires of a modern page.
 *
 * The era split is load-bearing rather than defensive. `skills/*` is a method
 * the SDK's era codecs do not define, so it is absent from their
 * cacheable-method registry and **nothing else validates this**: without an
 * era-aware schema a
 * modern server could answer `{ skills: [] }` and the conformance UI would
 * present it as a clean list. The legacy shape stays permissive because these
 * are 2026-era attributes a legacy server has no business sending.
 *
 * ⚠️ Picked by `InspectorClient.listSkills` from the negotiated era — a schema
 * cannot know it on its own.
 *
 * ⚠️ **No `resultType` member, and that is not an omission (#2373).** The
 * SDK's 2026-07-28 codec checks `resultType` on every result — missing is
 * `InvalidResult`, anything but `"complete"` is `UnsupportedResultType` — and
 * then **deletes it** before the result reaches the caller's schema. Requiring
 * it here therefore rejected every conforming modern page, and did so unseen
 * only because the integration suite's "modern" cases were connecting on
 * legacy. The caching attributes are different: the codec neither checks nor
 * lifts them for a consumer-owned method, so this schema is still the only
 * thing that does.
 */
export const ModernListSkillsResultSchema =
  // A non-negative INTEGER `ttlMs`, as the SDK states it: `ttlMs: -1` or `0.5`
  // is an envelope violation, and accepting it here would hide exactly the
  // kind of defect this schema exists to surface.
  ListSkillsResultSchema.extend(CACHE_FIELDS);

/**
 * The `skills/get` result envelope on a **legacy** connection: the entry
 * wrapped under `skill`, and nothing required beyond that.
 *
 * Its modern counterpart is {@link ModernGetSkillEnvelopeSchema}. SEP-2640 once
 * left open whether this result carries the caching attributes; the stable
 * ext-skills specification settles it — *"`GetSkillResult` extends
 * `CacheableResult`, so `ttlMs` and `cacheScope` are **REQUIRED**, as they are
 * on `resources/read`"* (#2404). Those are 2026-era attributes, so the legacy
 * shape stays permissive, exactly as {@link ListSkillsResultSchema} does.
 *
 * Required, not one of two accepted shapes. An earlier revision of this module
 * also accepted a bare entry at the top level, on the reading that the SEP
 * settled the entry but not its wrapper. It does settle the wrapper, and
 * accepting the inline form would silently normalize a non-conforming response
 * — which is exactly the failure this extension's support exists to *report*.
 * A server that returns the entry inline now fails the parse, loudly.
 */
export const GetSkillEnvelopeSchema = z.looseObject({
  skill: SkillEntrySchema,
});

/**
 * `skills/get` result envelope on a **modern** (2026-07-28+) connection: the
 * `{ skill }` wrapper plus `CacheableResult`'s required `ttlMs` / `cacheScope`
 * (#2404). Same field shapes as {@link ModernListSkillsResultSchema}, and the
 * same reason it exists: `skills/*` is consumer-owned, so the SDK codec checks
 * and lifts `resultType` but checks neither caching attribute, and without
 * this a modern server omitting them would be reported as clean.
 *
 * ⚠️ Picked by `InspectorClient.getSkillResult` from the negotiated era.
 */
export const ModernGetSkillEnvelopeSchema =
  GetSkillEnvelopeSchema.extend(CACHE_FIELDS);

/**
 * The `skills/get` result envelope as the SDK decoded it: the `skill` wrapper
 * plus any caching attributes the server sent. On a modern connection
 * `resultType` is not in it — the codec checks it and removes it before this
 * schema runs (#2373).
 *
 * Typed from the legacy schema, whose caching attributes are optional: the
 * modern schema only narrows them to required, so either era's result fits.
 *
 * Exported alongside the unwrapping schema below because the two callers want
 * different things: the UIs want the entry, while the CLI's job is to print
 * **the result** — and the caching attributes are members the transform
 * discards, so unwrapping for everyone silently dropped them from a contract
 * that promised not to reshape anything (Copilot).
 */
export type GetSkillEnvelope = z.infer<typeof GetSkillEnvelopeSchema>;

/**
 * `skills/get` result, unwrapped to the entry it carries.
 *
 * The transform means every caller receives a `SkillEntry` and none of them
 * reaches into the envelope; the strictness lives in the schema.
 */
export const GetSkillResultSchema = GetSkillEnvelopeSchema.transform(
  (result) => result.skill,
);

export type GetSkillResult = SkillEntry;

/**
 * `resources/directory/read` result on a **modern** (2026-07-28+) connection:
 * **the SDK's own `ReadResourceDirectoryResultSchema`**, used whole (#2804).
 *
 * Unlike the skill entry schemas above, nothing here needed to stay ours. A
 * directory child is a base-protocol `Resource` — SEP-2640 defines the result
 * as carrying "the same `Resource` objects that `resources/list` returns, with
 * the same `nextCursor` pagination contract" — and the SDK's
 * `DirectoryResourceSchema` is exactly `ResourceSchema`'s shape. The stable
 * ext-skills specification makes the result a `CacheableResult` (ext-skills#157,
 * #2740), so `ttlMs` and `cacheScope` are required, and the SDK's schema says
 * so.
 *
 * ⚠️ It is **stricter than the entry schemas**, and that is the deliberate
 * exception rather than an oversight. `Resource` requires `name`, so one child
 * missing `name` rejects the whole page instead of being reported as a
 * per-child finding — the opposite of the posture the entry schemas take. The
 * reason the trade goes the other way here is ownership: the skills entry
 * types are consumer-owned in the sense that nothing else reports on them, so
 * this module has to; `Resource` is base-protocol and already validated
 * exactly this strictly on the `resources/list` path, where `listSalvage` is
 * the answer to a single bad entry. Being *more* permissive here would mean a
 * URI that fails as a listed resource succeeds as a directory child, which is
 * a worse inconsistency than an all-or-nothing page.
 *
 * The SDK codec checks and lifts `resultType` on a modern result (#2373) but,
 * for a method it does not define, neither caching attribute — so this schema
 * is the only thing that does.
 *
 * ⚠️ Picked by `InspectorClient.readResourceDirectory` from the negotiated
 * era — a schema cannot know it on its own.
 */
export const ModernDirectoryReadResultSchema =
  ReadResourceDirectoryResultSchema;

/**
 * `resources/directory/read` result on a **legacy** connection: the SDK's
 * schema with the caching attributes made optional, which is exactly how
 * `SkillsClient` decodes a 2025-11-25 result (the backport has no caching
 * fields). Still `looseObject`, so a legacy server that also sends them is not
 * failed for doing so — the same posture {@link ListSkillsResultSchema} and
 * {@link GetSkillEnvelopeSchema} take.
 */
export const DirectoryReadResultSchema =
  ReadResourceDirectoryResultSchema.partial({ ttlMs: true, cacheScope: true });

/**
 * The result as the SDK decoded it, on either era. Typed from the legacy
 * schema, whose caching attributes are optional: the modern schema only
 * narrows them to required, so either era's result fits — the same reason
 * {@link GetSkillEnvelope} is typed from the legacy envelope.
 */
export type DirectoryReadResult = z.infer<typeof DirectoryReadResultSchema>;
