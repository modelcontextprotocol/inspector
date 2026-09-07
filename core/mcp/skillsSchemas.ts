/**
 * Skills extension wire schemas — SEP-2640 (`io.modelcontextprotocol/skills`).
 *
 * There is no `@modelcontextprotocol/ext-skills` package (404 on npm) and the
 * SDK's era codecs define none of these methods, so the Inspector drives them
 * as ordinary `client.request(…, ResultSchema)` calls with the explicit result
 * schemas below. That is exactly what the SDK prescribes for a consumer-owned
 * extension method: `Protocol._assertOutboundRequestInEra` only fires for names
 * one of the era codecs knows, so `skills/list` and `skills/get` are era-blind
 * and go out unchanged on both the 2025- and 2026-era legs. The raw-wire escape
 * hatch that modern `tasks/*` needs is deliberately NOT used here — `tasks/*`
 * are spec names the 2026 codec deleted, which is a different problem.
 *
 * **This module is the wire surface for the two methods the Inspector calls.**
 * SEP-2640 is Accepted, so the method names and the entry shape are settled;
 * the skill *format* is delegated to the independently-versioned Agent Skills
 * specification. Keeping every wire type here makes a spec revision a
 * single-file edit (#2234).
 *
 * **Permissive where a defect should be reported; strict where a shape is
 * settled.** `looseObject`, and a `digest` typed as a plain string rather than
 * a hex-constrained one, so a non-conforming server is *surfaced* by
 * `checkSkillConformance` rather than rejected at the parse — a malformed
 * digest is a finding, not a parse error to swallow. But a settled shape is
 * enforced, because silently normalizing one past the checks would defeat the
 * point: `skills/get` requires its `{ skill }` envelope, and a modern
 * `skills/list` result requires the base list envelope (see
 * `ModernListSkillsResultSchema`).
 */

import { z } from "zod/v4";
import { ResourceSchema } from "@modelcontextprotocol/core";

/** SEP-2133 extension identifier for the Skills extension (SEP-2640). */
export const SKILLS_EXTENSION_KEY = "io.modelcontextprotocol/skills";

/** The `skills/list` JSON-RPC method name. */
export const SKILLS_LIST_METHOD = "skills/list";

/** The `skills/get` JSON-RPC method name. */
export const SKILLS_GET_METHOD = "skills/get";

/**
 * The `resources/directory/read` method name, gated on the server declaring
 * `directoryRead: true` in its extension advertisement. Declared here so the
 * one wire-surface module names every method the extension defines, even though
 * the Inspector does not call it yet (phase 3 of #2234).
 */
export const RESOURCES_DIRECTORY_READ_METHOD = "resources/directory/read";

/** `mimeType` marking a resource as a directory rather than a file. */
export const DIRECTORY_MIME_TYPE = "inode/directory";

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
 * shapes mirror `ModernResultEnvelopeSchema` in `listSalvage.ts`, which is this
 * repo's existing statement of a modern result envelope and is already applied
 * to modern list results on the salvage path — so the two cannot drift.
 *
 * The era split is load-bearing rather than defensive. `skills/*` is a
 * consumer-owned method, so it is absent from the SDK's cacheable-method
 * registry and **nothing else validates this**: without an era-aware schema a
 * modern server could answer `{ skills: [] }` and the conformance UI would
 * present it as a clean list. The legacy shape stays permissive because these
 * are 2026-era attributes a legacy server has no business sending.
 *
 * ⚠️ Picked by `InspectorClient.listSkills` from the negotiated era — a schema
 * cannot know it on its own.
 */
export const ModernListSkillsResultSchema = ListSkillsResultSchema.extend({
  resultType: z.literal("complete"),
  // A non-negative INTEGER, matching the codec: `ttlMs: -1` or `0.5` is an
  // envelope violation, and accepting it here would hide exactly the kind of
  // defect this schema exists to surface.
  ttlMs: z.int().min(0),
  cacheScope: z.enum(["public", "private"]),
});

/**
 * The `skills/get` result envelope: the entry wrapped under `skill`.
 *
 * ⚠️ **Not era-aware, and that is settled rather than pending (#2248).** The
 * obvious symmetry would be a modern variant requiring the caching attributes
 * the way {@link ModernListSkillsResultSchema} does. SEP-2640 forecloses it in
 * as many words, under `skills/get`: *"whether the result should also carry the
 * base protocol's caching attributes (`ttlMs` and `cacheScope`, per SEP-2549),
 * as `resources/read` results do, is **left open**"*.
 *
 * So there is no requirement to enforce, and inventing one would do real harm
 * rather than none: a server that reasonably reads "left open" as "not
 * required" would be reported as non-conforming by the tool whose job is to
 * tell it whether it conforms. `looseObject` means a server that *does* send
 * them still parses, which is the right handling for an attribute the spec
 * permits and does not mandate. Revisit only if a later revision closes the
 * question — and note that the same sentence is why `skills/get` carries no
 * `nextCursor` handling either: "a single entry is not a list".
 *
 * Required, not one of two accepted shapes. An earlier revision of this module
 * also accepted a bare entry at the top level, on the reading that the SEP
 * settled the entry but not its wrapper. It does settle the wrapper, and
 * accepting the inline form would silently normalize a non-conforming response
 * — which is exactly the failure this extension's support exists to *report*.
 * A server that returns the entry inline now fails the parse, loudly.
 */
const GetSkillEnvelopeSchema = z.looseObject({ skill: SkillEntrySchema });

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
 * One `resources/directory/read` child: **the SDK's own `Resource`**, not a
 * shape restated here.
 *
 * SEP-2640 defines the result as carrying "the same `Resource` objects that
 * `resources/list` returns, with the same `nextCursor` pagination contract", so
 * the schema that already decodes `resources/list` in this app is the literal
 * statement of that sentence — and one the SDK, not this module, keeps current.
 * Restating it would let the two drift, at which point a directory child and a
 * listed resource could disagree about what a `Resource` is while both claimed
 * to be one.
 *
 * ⚠️ It is **stricter than everything else in this module**, and that is the
 * deliberate exception rather than an oversight. `ResourceSchema` requires
 * `name` and strips unknown members, so one child missing `name` rejects the
 * whole page instead of being reported as a per-child finding — the opposite of
 * the posture the entry schemas above take. The reason the trade goes the other
 * way here is ownership: the skills entry types are consumer-owned and nothing
 * else validates them, so this module has to be the reporter; `Resource` is
 * base-protocol and already validated exactly this strictly on the
 * `resources/list` path, where {@link listSalvage} is the answer to a single bad
 * entry. Being *more* permissive here would mean a URI that fails as a listed
 * resource succeeds as a directory child, which is a worse inconsistency than
 * an all-or-nothing page.
 */
export const DirectoryChildSchema = ResourceSchema;

/**
 * `resources/directory/read` result on a **legacy** connection: the directory's
 * direct children plus the opaque cursor.
 *
 * `looseObject`, matching every other result schema here: a server that also
 * sends the caching attributes is not wrong for doing so, and a schema is not
 * the place to reject an extra member.
 */
export const DirectoryReadResultSchema = z.looseObject({
  resources: z.array(DirectoryChildSchema),
  nextCursor: z.string().optional(),
});

export type DirectoryReadResult = z.infer<typeof DirectoryReadResultSchema>;

/**
 * `resources/directory/read` result on a **modern** (2026-07-28+) connection:
 * the page plus `resultType`, and deliberately **not** `ttlMs` / `cacheScope`.
 *
 * That asymmetry with {@link ModernListSkillsResultSchema} is the one judgement
 * call in this module, so it is written down rather than left to be re-derived:
 *
 *  - For `skills/list` the SEP states the requirement outright — *"In protocol
 *    versions 2026-07-28 and later, the result also carries … `ttlMs` and
 *    `cacheScope`"* — so requiring them is quoting the spec.
 *  - For `resources/directory/read` it states **nothing of the kind**, and its
 *    one worked example of the result carries `resultType: "complete"` and no
 *    caching attributes at all. Requiring them here would fail a server that
 *    matched the SEP's own example, which is the failure direction this module
 *    works hardest to avoid.
 *
 * `resultType` is required because it is the base protocol's, not this
 * extension's: SEP-2322 makes it a member of every modern result, the SEP's
 * example carries it, and `skills/*` being consumer-owned means the SDK codec
 * validates none of it — so if this schema does not, nothing does.
 *
 * ⚠️ Picked by `InspectorClient.readResourceDirectory` from the negotiated era.
 */
export const ModernDirectoryReadResultSchema = DirectoryReadResultSchema.extend(
  { resultType: z.literal("complete") },
);
