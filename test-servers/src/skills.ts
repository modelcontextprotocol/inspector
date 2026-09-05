/**
 * Skills extension test fixture — SEP-2640 (`io.modelcontextprotocol/skills`).
 *
 * Serves `skills/list` (paginated) and `skills/get`, plus `resources/read` for
 * the `skill://` URIs those entries name, so an Inspector connected here can
 * exercise the whole flow: enumerate, fetch a file, and verify its digest.
 *
 * **The awkward skills are the point.** A fixture that only served a clean
 * skill would leave every verification and conformance path in the Inspector
 * untestable, so the set below deliberately includes three edge cases — each
 * the exact shape one of the checks in `core/mcp/skills.ts` exists to catch:
 *
 *  - `dynamic-report` declares `resources: "dynamic"`. That is a **conforming**
 *    wire form for generated content, not a violation; what it costs is that
 *    integrity cannot be verified at all, which the Inspector reports as a
 *    warning. It is here because "legal but unverifiable" is the case most
 *    easily buried.
 *  - `tampered-notes` advertises a digest that does not match the bytes it
 *    serves — a genuine violation.
 *  - `wrong-folder` has a URI path segment that disagrees with
 *    `frontmatter.name` — the other genuine violation.
 *
 * `skills/list` and `skills/get` are registered through the **public**
 * `setRequestHandler`, which accepts a consumer-owned method name as long as
 * explicit schemas are supplied — no private-field escape hatch, and the params
 * are validated on the way in. That is the difference from `modern-tasks.ts`:
 * `tasks/*` are spec names the 2026 codec deleted, so they need the raw seam;
 * `skills/*` are in neither codec, which makes them era-blind in both
 * directions and lets one fixture serve both the legacy and modern legs.
 *
 * `resources/read` is the one exception, and it is a *wrap* rather than a
 * registration: the fixture must answer `skill://` URIs while leaving every
 * other URI to the SDK's own handler, and `setRequestHandler` replaces a
 * handler instead of chaining onto it. There is no public "extend this method"
 * API, so the existing handler is captured and delegated to.
 */

import { createHash } from "node:crypto";
import * as z from "zod/v4";
import {
  ProtocolError,
  ProtocolErrorCode,
  type McpServer,
} from "@modelcontextprotocol/server";

/** SEP-2133 extension identifier for the Skills extension (SEP-2640). */
export const SKILLS_EXTENSION_KEY = "io.modelcontextprotocol/skills";

/**
 * Entries per `skills/list` page. Two, deliberately: the fixture serves four
 * skills, so a client that stops after page one sees half the set — which is
 * what makes a broken cursor walk visible rather than merely slower.
 */
export const SKILLS_PAGE_SIZE = 2;

/**
 * The modern (2026-07-28) base result envelope, stamped on every skills result.
 *
 * The SDK stamps this for methods in its own codec, and `skills/*` are
 * consumer-owned — so nothing adds it here and a modern connection would
 * otherwise receive a result missing `resultType` / `ttlMs` / `cacheScope`.
 * Stamped **unconditionally** rather than per era: one `McpServer` config
 * serves both legs, the modern leg builds a fresh server per request so there
 * is no era to branch on at handler-registration time, and on the legacy leg
 * these are three unknown members that a consumer-owned method has no codec to
 * reject. Values match `ModernResultEnvelopeSchema` in `core/mcp/listSalvage.ts`.
 */
const MODERN_RESULT_ENVELOPE = {
  resultType: "complete",
  ttlMs: 0,
  cacheScope: "public",
} as const;

/** `sha256:<64 lowercase hex>` over a UTF-8 string, the SEP's digest form. */
function digestOf(text: string): string {
  return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

/** Byte length of a UTF-8 string, for the manifest's `size`. */
function sizeOf(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

interface FixtureFile {
  uri: string;
  text: string;
  mimeType: string;
  /**
   * Digest to *advertise*, when it should differ from the real one. The
   * tampered skill sets this; everywhere else the advertised digest is
   * computed from the very bytes served, so a clean skill verifies.
   */
  advertisedDigest?: string;
}

interface FixtureSkill {
  /** The `<skill-path>` segment; `skill://<path>/SKILL.md` is the entry URI. */
  path: string;
  /** The SAME object the served `SKILL.md` was built from — see `skillMd`. */
  frontmatter: Frontmatter;
  /** `"dynamic"` for a generated skill with no enumerable manifest. */
  files: FixtureFile[] | "dynamic";
}

interface Frontmatter {
  name: string;
  description: string;
}

/**
 * The `SKILL.md` for one skill, built FROM its frontmatter object.
 *
 * SEP-2640 requires the frontmatter a server lists to match the frontmatter in
 * the file it serves, field for field. Writing the two out separately let them
 * drift — and did: three fixtures listed one description and served another,
 * which is an undocumented extra violation that would have made phase 3's
 * frontmatter check report a finding these fixtures were not built to
 * demonstrate. Deriving one from the other makes that class of drift
 * impossible rather than merely fixed.
 */
function skillMd(frontmatter: Frontmatter, body: string): string {
  return `---\nname: ${frontmatter.name}\ndescription: ${frontmatter.description}\n---\n\n${body}\n`;
}

const DATA_ANALYSIS_FM: Frontmatter = {
  name: "data-analysis",
  description: "Analyze a CSV and summarize its columns",
};
const DATA_ANALYSIS_MD = skillMd(
  DATA_ANALYSIS_FM,
  "# Data analysis\n\nLoad the CSV, then follow `reference.md` for the column rules.",
);
const DATA_ANALYSIS_REF =
  "# Column rules\n\nNumeric columns get min/max/mean; text columns get a value count.\n";

const TAMPERED_FM: Frontmatter = {
  name: "tampered-notes",
  description: "A skill whose manifest digest does not match its served bytes",
};
const TAMPERED_MD = skillMd(
  TAMPERED_FM,
  "# Tampered notes\n\nThe digest advertised for `notes.md` is wrong on purpose.",
);
const TAMPERED_NOTES =
  "# Notes\n\nThese bytes hash to something other than what the manifest claims.\n";

const DYNAMIC_FM: Frontmatter = {
  name: "dynamic-report",
  description: "A skill whose files are generated per request",
};
const DYNAMIC_MD = skillMd(
  DYNAMIC_FM,
  "# Dynamic report\n\nThis skill's file set is generated, so it advertises no manifest.",
);

// The frontmatter says `right-name` while the URI segment says `wrong-folder`,
// breaking the one structural invariant SEP-2640 states outright: the segment
// before /SKILL.md must equal frontmatter.name. That is this fixture's ONLY
// violation — its listed and served frontmatter agree, as the SEP requires.
const MISMATCHED_FM: Frontmatter = {
  name: "right-name",
  description:
    "A skill whose URI path segment disagrees with its frontmatter name",
};
const MISMATCHED_MD = skillMd(
  MISMATCHED_FM,
  "# Mismatched name\n\nServed from `wrong-folder/` while claiming the name `right-name`.",
);

const FIXTURE_SKILLS: FixtureSkill[] = [
  {
    path: "data-analysis",
    frontmatter: DATA_ANALYSIS_FM,
    files: [
      {
        uri: "skill://data-analysis/SKILL.md",
        text: DATA_ANALYSIS_MD,
        mimeType: "text/markdown",
      },
      {
        uri: "skill://data-analysis/reference.md",
        text: DATA_ANALYSIS_REF,
        mimeType: "text/markdown",
      },
    ],
  },
  {
    path: "tampered-notes",
    frontmatter: TAMPERED_FM,
    files: [
      {
        uri: "skill://tampered-notes/SKILL.md",
        text: TAMPERED_MD,
        mimeType: "text/markdown",
      },
      {
        uri: "skill://tampered-notes/notes.md",
        text: TAMPERED_NOTES,
        mimeType: "text/markdown",
        // A syntactically valid digest of the *wrong* bytes, so the failure the
        // Inspector reports is a mismatch rather than a malformed-digest
        // finding — those are different checks and must stay distinguishable.
        advertisedDigest: digestOf("not the bytes this server serves"),
      },
    ],
  },
  {
    path: "dynamic-report",
    frontmatter: DYNAMIC_FM,
    files: "dynamic",
  },
  {
    path: "wrong-folder",
    frontmatter: MISMATCHED_FM,
    files: [
      {
        uri: "skill://wrong-folder/SKILL.md",
        text: MISMATCHED_MD,
        mimeType: "text/markdown",
      },
    ],
  },
];

/** Every servable `skill://` file, by URI. `dynamic` skills contribute their
 * `SKILL.md` too, so the screen's "View SKILL.md" works there as well. */
const FILES_BY_URI = new Map<string, FixtureFile>();
for (const skill of FIXTURE_SKILLS) {
  if (skill.files === "dynamic") {
    FILES_BY_URI.set(`skill://${skill.path}/SKILL.md`, {
      uri: `skill://${skill.path}/SKILL.md`,
      text: DYNAMIC_MD,
      mimeType: "text/markdown",
    });
    continue;
  }
  for (const file of skill.files) FILES_BY_URI.set(file.uri, file);
}

/** The wire entry for one fixture skill. */
function toEntry(skill: FixtureSkill): z.infer<typeof SkillEntryShape> {
  return {
    uri: `skill://${skill.path}/SKILL.md`,
    frontmatter: skill.frontmatter,
    resources:
      skill.files === "dynamic"
        ? "dynamic"
        : skill.files.map((file) => ({
            uri: file.uri,
            digest: file.advertisedDigest ?? digestOf(file.text),
            size: sizeOf(file.text),
          })),
  };
}

/** One `skills/list` page starting at `cursor` (an index, as a string). */
export function listSkillsPage(
  cursor?: string,
): z.infer<typeof ListSkillsResultShape> {
  const start = cursor ? Number.parseInt(cursor, 10) : 0;
  // A cursor the fixture never issued is answered as an empty final page
  // rather than an error: the Inspector's walk should terminate, and a thrown
  // error here would read as a transport failure instead.
  const from = Number.isFinite(start) && start > 0 ? start : 0;
  const page = FIXTURE_SKILLS.slice(from, from + SKILLS_PAGE_SIZE);
  const next = from + SKILLS_PAGE_SIZE;
  return {
    ...MODERN_RESULT_ENVELOPE,
    skills: page.map(toEntry),
    ...(next < FIXTURE_SKILLS.length ? { nextCursor: String(next) } : {}),
  };
}

/** The `skills/get` result for one entry URI. */
export function getSkillEntry(
  uri: string,
): z.infer<typeof GetSkillResultShape> {
  const skill = FIXTURE_SKILLS.find(
    (candidate) => `skill://${candidate.path}/SKILL.md` === uri,
  );
  // `-32602`, not a plain `Error`: the method contract says an unknown skill
  // URI is invalid params, and a generic throw would be mapped to a server
  // failure — making the fixture non-conforming outside its three documented
  // bad cases, which is the opposite of what it is for.
  if (!skill) {
    throw new ProtocolError(
      ProtocolErrorCode.InvalidParams,
      `Unknown skill uri: ${uri}`,
    );
  }
  // The `{ skill }` wrapper is the conforming shape, and the only one the
  // Inspector accepts — see `GetSkillResultSchema`.
  return { ...MODERN_RESULT_ENVELOPE, skill: toEntry(skill) };
}

/** The `resources/read` result for a `skill://` file, or `undefined`. */
export function readSkillFile(
  uri: string,
): Record<string, unknown> | undefined {
  const file = FILES_BY_URI.get(uri);
  if (!file) return undefined;
  return {
    ...MODERN_RESULT_ENVELOPE,
    contents: [{ uri: file.uri, mimeType: file.mimeType, text: file.text }],
  };
}

/**
 * The private handler registry the SDK dispatches through. Reached ONLY to wrap
 * `resources/read` — see the module header for why that one has no public
 * equivalent.
 */
interface RawHandlerHost {
  _requestHandlers: Map<
    string,
    (request: unknown, ctx: unknown) => Promise<unknown>
  >;
}

interface UriRequest {
  params?: { uri?: string };
}

const ListSkillsParamsSchema = z.object({ cursor: z.string().optional() });
const GetSkillParamsSchema = z.object({ uri: z.string() });

/**
 * Result schemas for the two custom methods.
 *
 * ⚠️ The SDK does **not** runtime-validate a handler's result — its own doc on
 * `RequestHandlerSchemas` says `result` is optional and "no runtime validation
 * is performed on the result". So these do not make the fixture's output
 * checked at the server boundary; what they buy is that the handler's return
 * type is inferred from them, so a shape change in `toEntry` or
 * `listSkillsPage` fails `tsc` instead of silently shipping a fixture that
 * claims to be conforming. That is the whole benefit, and it is worth having
 * for a fixture whose job is to be wrong only in documented ways.
 *
 * Deliberately declared here rather than imported from
 * `core/mcp/skillsSchemas.ts`: a fixture that validated itself against the
 * client's own schema could never catch the client being wrong.
 */
const ModernEnvelopeShape = {
  resultType: z.literal("complete"),
  ttlMs: z.int().min(0),
  cacheScope: z.enum(["public", "private"]),
};

const SkillResourceShape = z.object({
  uri: z.string(),
  digest: z.string(),
  size: z.number(),
});

const SkillEntryShape = z.object({
  uri: z.string(),
  frontmatter: z.object({ name: z.string(), description: z.string() }),
  resources: z.union([z.literal("dynamic"), z.array(SkillResourceShape)]),
});

const ListSkillsResultShape = z.object({
  ...ModernEnvelopeShape,
  skills: z.array(SkillEntryShape),
  nextCursor: z.string().optional(),
});

const GetSkillResultShape = z.object({
  ...ModernEnvelopeShape,
  skill: SkillEntryShape,
});

/**
 * Wire `skills/list`, `skills/get` and the `skill://` half of `resources/read`
 * onto an `McpServer`.
 */
export function wireSkillsHandlers(mcpServer: McpServer): void {
  const lowLevel = mcpServer.server;

  lowLevel.setRequestHandler(
    "skills/list",
    { params: ListSkillsParamsSchema, result: ListSkillsResultShape },
    async (params) => listSkillsPage(params.cursor),
  );

  lowLevel.setRequestHandler(
    "skills/get",
    { params: GetSkillParamsSchema, result: GetSkillResultShape },
    async (params) => getSkillEntry(params.uri),
  );

  // Wrapped, not registered: a `skill://` URI is answered here and everything
  // else falls through to whatever the SDK registered, so a config can serve
  // ordinary resources alongside its skills.
  const registry = (lowLevel as unknown as RawHandlerHost)._requestHandlers;
  const sdkResourcesRead = registry.get("resources/read");
  registry.set("resources/read", async (request, ctx) => {
    const req = request as UriRequest;
    const skillFile = readSkillFile(req.params?.uri ?? "");
    if (skillFile) return skillFile;
    if (!sdkResourcesRead) {
      throw new ProtocolError(
        ProtocolErrorCode.InvalidParams,
        `Unknown resource: ${req.params?.uri}`,
      );
    }
    return sdkResourcesRead(request, ctx);
  });
}
