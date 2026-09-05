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
 * ⚠️ **No `resources/directory/read` result schema here yet, on purpose.**
 *
 * The method name and the directory MIME type above are stated in SEP-2640;
 * the shape of the result it returns is not something this PR verified against
 * the normative text, and the Inspector does not call the method (phase 3,
 * #2248). Declaring a guessed schema would put an unverified claim in the one
 * module that is supposed to be the authority on the wire format — and one
 * nothing exercises, so it could be wrong indefinitely without failing
 * anything. Phase 3 adds it against the spec, alongside the call that uses it.
 */
